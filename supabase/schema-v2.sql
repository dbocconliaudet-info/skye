-- ============================================================================
--  ToDomTaDam — évolutions v2 : comptes, Row Level Security, dates, messages
--
--  À passer APRÈS `schema.sql`, dans Supabase → SQL Editor → New query → Run.
--  Le script est idempotent : le relancer ne détruit aucune donnée.
--
--  Ce script ferme la « limite de sécurité assumée » du v1 : à partir d'ici,
--  la base ne répond plus qu'à des utilisateurs authentifiés, et chacun ne
--  voit que les lignes de son propre espace.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
--  1. Colonnes nouvelles
-- ---------------------------------------------------------------------------

-- `prenom` devient `pseudo` (§1 des évolutions) : c'est le nom choisi à la
-- création du compte, et le seul affiché dans l'app. Le renommage n'a lieu
-- qu'une fois — au deuxième passage du script, la colonne s'appelle déjà pseudo.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'membres'
                and column_name = 'prenom')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'membres'
                and column_name = 'pseudo')
  then
    alter table public.membres rename column prenom to pseudo;
  end if;
end $$;

-- Lien vers le compte Supabase Auth. Nullable à dessein : les deux membres
-- créés avec la v1 n'ont pas encore de compte, ils seront repris à la première
-- connexion (voir `rejoindre_espace` plus bas).
alter table public.membres add column if not exists user_id uuid
  references auth.users(id) on delete set null;

-- Un compte appartient à un seul membre, donc à un seul espace (§4 du brief
-- initial : un espace = deux personnes). Garanti côté base, pas seulement côté app.
create unique index if not exists membres_user_unique
  on public.membres (user_id) where user_id is not null;

-- Dates de naissance et de mariage/PACS (§2 des évolutions), toutes deux
-- optionnelles : elles ne doivent jamais bloquer une inscription.
alter table public.membres add column if not exists date_naissance date;
alter table public.espaces add column if not exists date_mariage_pacs date;

-- ---------------------------------------------------------------------------
--  2. Messages au/à la partenaire (§4 des évolutions)
-- ---------------------------------------------------------------------------

-- Même schéma d'adressage que les tâches : soit une personne précise, soit
-- les deux — deux colonnes plutôt qu'une valeur magique dans la clé étrangère.
create table if not exists public.messages (
  id                     uuid primary key default gen_random_uuid(),
  espace_id              uuid not null references public.espaces(id) on delete cascade,
  auteur_membre_id       uuid references public.membres(id) on delete set null,
  destinataire_membre_id uuid references public.membres(id) on delete cascade,
  destinataire_les_deux  boolean not null default false,
  contenu                text not null,
  lu                     boolean not null default false,
  cree_le                timestamptz not null default now()
);

create index if not exists messages_espace_idx on public.messages (espace_id);
create index if not exists messages_non_lus_idx
  on public.messages (espace_id, destinataire_membre_id) where not lu;

-- Redondant avec la boucle du §6, qui l'active sur toutes les tables : c'est
-- volontaire. Une table nouvellement créée doit être verrouillée dans la même
-- respiration, sans dépendre d'une boucle qui viendrait deux cents lignes plus
-- bas — et l'analyseur de Supabase, qui ne lit pas le SQL construit à la volée,
-- signalerait sinon `messages` comme une table ouverte.
alter table public.messages enable row level security;

-- ---------------------------------------------------------------------------
--  3. À qui ai-je affaire ? (fonctions de base des policies)
-- ---------------------------------------------------------------------------
--  `security definer` est indispensable ici, et pas par confort : une policy
--  posée sur `membres` qui interrogerait `membres` déclencherait une récursion
--  infinie côté Postgres. En s'exécutant avec les droits du propriétaire, la
--  fonction lit la table sans repasser par la RLS, ce qui casse la boucle.
--
--  `set search_path = public` empêche qu'un schéma inséré devant `public` par
--  un appelant ne détourne la fonction vers une fausse table `membres`.
-- ---------------------------------------------------------------------------

create or replace function public.mon_membre_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.membres where user_id = auth.uid() limit 1;
$$;

create or replace function public.mon_espace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select espace_id from public.membres where user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------------
--  4. Créer un espace, rejoindre un espace
-- ---------------------------------------------------------------------------
--  Ces deux opérations sont le seul moment où quelqu'un doit toucher des
--  lignes qu'il n'a pas encore le droit de voir : on ne peut pas lire un
--  espace avant d'en être membre, ni s'y ajouter avant qu'il existe.
--
--  Plutôt que d'ouvrir `espaces` et `membres` en écriture à tout le monde —
--  ce qui reproduirait exactement le trou de la v1 — ces fonctions font le
--  travail sous le contrôle du serveur, en vérifiant à chaque fois qui appelle
--  et ce qu'il a le droit de faire.
-- ---------------------------------------------------------------------------

-- Jeton d'invitation : même alphabet que la v1 (ni « l », ni « 1 », ni « 0 »,
-- pour qu'il reste dictable au téléphone sans ambiguïté).
create or replace function public.jeton_invitation()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('abcdefghijkmnopqrstuvwxyz23456789', 1 + floor(random() * 33)::int, 1), '')
  from generate_series(1, 22);
$$;

create or replace function public.creer_espace(
  p_nom            text,
  p_pseudo         text,
  p_date_naissance date default null,
  p_date_mariage   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_espace public.espaces;
  v_membre public.membres;
begin
  if v_uid is null then
    raise exception 'Connexion requise';
  end if;
  if coalesce(trim(p_nom), '') = '' or coalesce(trim(p_pseudo), '') = '' then
    raise exception 'Le nom de l''espace et le pseudo sont obligatoires';
  end if;
  if exists (select 1 from public.membres where user_id = v_uid) then
    raise exception 'Tu fais déjà partie d''un espace';
  end if;

  insert into public.espaces (nom, lien_invitation, date_mariage_pacs)
  values (trim(p_nom), public.jeton_invitation(), p_date_mariage)
  returning * into v_espace;

  insert into public.membres (espace_id, pseudo, user_id, date_naissance)
  values (v_espace.id, trim(p_pseudo), v_uid, p_date_naissance)
  returning * into v_membre;

  -- Liste de courses permanente, créée d'office (§7 du brief : toujours présente).
  insert into public.listes_courses (espace_id, nom, type)
  values (v_espace.id, 'Liste permanente', 'permanente');

  return jsonb_build_object(
    'espace_id', v_espace.id,
    'espace_nom', v_espace.nom,
    'jeton', v_espace.lien_invitation,
    'membre_id', v_membre.id);
end $$;

-- Ce que voit l'écran « rejoindre » avant que la personne ait un pied dans
-- l'espace : le nom du foyer, et les membres encore sans compte — ceux créés
-- avec la v1, qu'on peut donc reprendre. Rien d'autre ne sort d'ici : ni les
-- tâches, ni les courses, ni les emails.
create or replace function public.apercu_espace(p_jeton text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'espace_nom', e.nom,
    'places_libres', greatest(0, 2 - (select count(*) from public.membres m where m.espace_id = e.id)),
    'membres_a_reprendre', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'pseudo', m.pseudo) order by m.cree_le)
      from public.membres m
      where m.espace_id = e.id and m.user_id is null), '[]'::jsonb))
  from public.espaces e
  where e.lien_invitation = lower(trim(p_jeton));
$$;

-- Rejoindre, dans les deux cas de figure :
--   • p_membre_id fourni  → reprise d'un membre créé avec la v1, ce qui garde
--     tout l'historique de tâches déjà attaché à ce membre ;
--   • p_membre_id absent  → création d'un nouveau membre, s'il reste une place.
create or replace function public.rejoindre_espace(
  p_jeton          text,
  p_pseudo         text,
  p_date_naissance date default null,
  p_membre_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_espace  public.espaces;
  v_membre  public.membres;
  v_pseudo  text := nullif(trim(p_pseudo), '');
  v_nb      int;
begin
  if v_uid is null then
    raise exception 'Connexion requise';
  end if;

  select * into v_espace from public.espaces
   where lien_invitation = lower(trim(p_jeton));
  if not found then
    raise exception 'Code inconnu';
  end if;

  -- Déjà membre : on ne recrée rien, on renvoie simplement de quoi entrer.
  -- C'est le cas quand quelqu'un rouvre son propre lien d'invitation.
  select * into v_membre from public.membres where user_id = v_uid;
  if found then
    if v_membre.espace_id <> v_espace.id then
      raise exception 'Tu fais déjà partie d''un autre espace';
    end if;
    return jsonb_build_object(
      'espace_id', v_espace.id, 'espace_nom', v_espace.nom,
      'jeton', v_espace.lien_invitation, 'membre_id', v_membre.id);
  end if;

  if p_membre_id is not null then
    -- La condition `user_id is null` est dans le UPDATE, pas dans un test
    -- préalable : si les deux téléphones tentent la même reprise en même
    -- temps, le second ne met à jour aucune ligne et reçoit l'erreur.
    update public.membres
       set user_id        = v_uid,
           pseudo         = coalesce(v_pseudo, pseudo),
           date_naissance = coalesce(p_date_naissance, date_naissance)
     where id = p_membre_id and espace_id = v_espace.id and user_id is null
    returning * into v_membre;
    if not found then
      raise exception 'Ce membre a déjà été repris par quelqu''un';
    end if;
  else
    if v_pseudo is null then
      raise exception 'Le pseudo est obligatoire';
    end if;
    -- Sérialise les arrivées simultanées sur cet espace, sans quoi deux
    -- inscriptions en même temps pourraient créer un troisième membre.
    perform pg_advisory_xact_lock(hashtext(v_espace.id::text));
    select count(*) into v_nb from public.membres where espace_id = v_espace.id;
    if v_nb >= 2 then
      raise exception 'Cet espace est complet';
    end if;
    insert into public.membres (espace_id, pseudo, user_id, date_naissance)
    values (v_espace.id, v_pseudo, v_uid, p_date_naissance)
    returning * into v_membre;
  end if;

  return jsonb_build_object(
    'espace_id', v_espace.id, 'espace_nom', v_espace.nom,
    'jeton', v_espace.lien_invitation, 'membre_id', v_membre.id);
end $$;

-- ---------------------------------------------------------------------------
--  5. Droits d'appel
-- ---------------------------------------------------------------------------
--  `creer_espace` et `rejoindre_espace` exigent une session : un visiteur
--  anonyme n'a donc rien à en faire.
--
--  `apercu_espace` est la seule exception, et elle est voulue : quelqu'un qui
--  ouvre le lien d'invitation doit voir « Rejoindre l'espace Famille Dupont »
--  et choisir qui il est AVANT de créer son compte. Ce qui sort de cette
--  fonction se limite au nom du foyer et aux pseudos des membres sans compte,
--  et uniquement contre un jeton de 22 caractères — le même jeton qui donne
--  déjà le droit d'entrer. On n'élargit donc rien : on expose deux libellés
--  à qui possède déjà la clé.

revoke all on function public.jeton_invitation()   from public, anon, authenticated;
revoke all on function public.mon_membre_id()      from public, anon;
revoke all on function public.mon_espace_id()      from public, anon;
revoke all on function public.creer_espace(text, text, date, date)             from public, anon;
revoke all on function public.apercu_espace(text)                              from public;
revoke all on function public.rejoindre_espace(text, text, date, uuid)         from public, anon;

grant execute on function public.mon_membre_id()   to authenticated;
grant execute on function public.mon_espace_id()   to authenticated;
grant execute on function public.creer_espace(text, text, date, date)          to authenticated;
grant execute on function public.apercu_espace(text)                           to anon, authenticated;
grant execute on function public.rejoindre_espace(text, text, date, uuid)      to authenticated;

-- ---------------------------------------------------------------------------
--  6. Row Level Security — pour de vrai cette fois
-- ---------------------------------------------------------------------------
--  Remplace la policy `acces_ouvert_v1` du premier livrable, qui laissait
--  passer tout le monde faute d'authentification. Deux verrous, comme dans
--  schema.sql : le GRANT dit qui a le droit de toucher la table, la policy dit
--  quelles lignes il voit.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['espaces', 'membres', 'taches', 'listes_courses',
                           'articles_courses', 'dictionnaire_rayons', 'messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists acces_ouvert_v1 on public.%I', t);
    -- Le rôle anonyme n'a plus rien à faire ici : sans session, l'API répond
    -- désormais « permission denied », avant même d'en arriver aux policies.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Les tables « de contenu » suivent toutes la même règle : une ligne est à moi
-- si son espace est le mien. Le `with check` sert à l'écriture — sans lui, on
-- pourrait insérer une tâche dans l'espace du voisin.
do $$
declare t text;
begin
  foreach t in array array['taches', 'listes_courses', 'articles_courses',
                           'dictionnaire_rayons']
  loop
    execute format('drop policy if exists espace_membre on public.%I', t);
    execute format(
      'create policy espace_membre on public.%I for all to authenticated '
      'using (espace_id = public.mon_espace_id()) '
      'with check (espace_id = public.mon_espace_id())', t);
  end loop;
end $$;

-- Espaces : lecture et modification (le nom, la date de mariage) par ses
-- membres. Pas de policy d'insertion : la création passe par `creer_espace`,
-- qui est seule à savoir créer l'espace, son premier membre et sa liste
-- permanente d'un seul tenant. Pas de suppression non plus — un espace
-- effacé emporterait tout l'historique avec lui.
drop policy if exists espaces_lecture on public.espaces;
create policy espaces_lecture on public.espaces for select to authenticated
  using (id = public.mon_espace_id());

drop policy if exists espaces_maj on public.espaces;
create policy espaces_maj on public.espaces for update to authenticated
  using (id = public.mon_espace_id())
  with check (id = public.mon_espace_id());

revoke insert, delete on public.espaces from authenticated;

-- Membres : chacun voit les deux membres de son espace (le board a besoin des
-- pseudos), mais ne modifie que sa propre ligne — personne ne renomme l'autre.
-- L'arrivée d'un membre passe par `rejoindre_espace`, qui compte les places.
drop policy if exists membres_lecture on public.membres;
create policy membres_lecture on public.membres for select to authenticated
  using (espace_id = public.mon_espace_id());

drop policy if exists membres_maj on public.membres;
create policy membres_maj on public.membres for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke insert, delete on public.membres from authenticated;

-- Messages : un mot doux ne se relit pas (§4 des évolutions — pas d'historique).
-- La lecture est donc limitée à son destinataire ; l'auteur lui-même ne le
-- récupère pas une fois envoyé. C'est la base qui l'applique, pas l'affichage.
drop policy if exists messages_lecture on public.messages;
create policy messages_lecture on public.messages for select to authenticated
  using (espace_id = public.mon_espace_id()
         and (destinataire_les_deux or destinataire_membre_id = public.mon_membre_id()));

drop policy if exists messages_ecriture on public.messages;
create policy messages_ecriture on public.messages for insert to authenticated
  with check (espace_id = public.mon_espace_id()
              and auteur_membre_id = public.mon_membre_id());

-- Marquer comme lu : réservé au destinataire.
drop policy if exists messages_maj on public.messages;
create policy messages_maj on public.messages for update to authenticated
  using (espace_id = public.mon_espace_id()
         and (destinataire_les_deux or destinataire_membre_id = public.mon_membre_id()))
  with check (espace_id = public.mon_espace_id());

revoke delete on public.messages from authenticated;

-- ---------------------------------------------------------------------------
--  7. Temps réel
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['taches', 'listes_courses', 'articles_courses',
                           'membres', 'dictionnaire_rayons', 'messages']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- déjà publiée, rien à faire
    end;
  end loop;
end $$;

-- Par défaut, un événement DELETE ne transporte que la clé primaire de la
-- ligne effacée. Ça ne suffit plus maintenant que la RLS est active : Postgres
-- doit pouvoir lire `espace_id` sur la ligne supprimée pour décider qui a le
-- droit d'en être informé. Sans ça, cocher un article ou supprimer une tâche
-- ne rafraîchirait pas l'écran d'en face.
do $$
declare t text;
begin
  foreach t in array array['taches', 'listes_courses', 'articles_courses',
                           'membres', 'dictionnaire_rayons', 'messages']
  loop
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
