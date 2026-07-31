-- ============================================================================
--  ToDomTaDam — schéma de base de données
--  À coller tel quel dans Supabase → SQL Editor → New query → Run.
--  Le script est idempotent : le relancer ne casse rien.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
--  Espaces et membres
-- ---------------------------------------------------------------------------

create table if not exists public.espaces (
  id              uuid primary key default gen_random_uuid(),
  nom             text not null,
  lien_invitation text not null unique,
  cree_le         timestamptz not null default now()
);

create table if not exists public.membres (
  id        uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.espaces(id) on delete cascade,
  prenom    text not null,
  cree_le   timestamptz not null default now()
);

create index if not exists membres_espace_idx on public.membres (espace_id);

-- ---------------------------------------------------------------------------
--  Module « On s'en occupe »
-- ---------------------------------------------------------------------------

create table if not exists public.taches (
  id                uuid primary key default gen_random_uuid(),
  espace_id         uuid not null references public.espaces(id) on delete cascade,
  titre             text not null,
  description       text,

  -- Assignation : soit un membre précis, soit les deux (assigne_aux_deux = true).
  assigne_a         uuid references public.membres(id) on delete set null,
  assigne_aux_deux  boolean not null default false,

  categorie         text not null default 'maison'
                    check (categorie in ('admin','maison','famille','amis',
                                         'cadeaux','vacances','sport','loisirs','sante')),
  priorite          text not null default 'moyenne'
                    check (priorite in ('basse','moyenne','haute')),

  -- Progression et tag indépendant : une tâche peut être « fait » ET « devenu
  -- sans objet » en même temps, d'où deux colonnes distinctes.
  statut            text not null default 'a_faire'
                    check (statut in ('a_faire','en_cours','fait')),
  devenu_sans_objet boolean not null default false,

  date_limite       date,

  -- Récurrence, ex :
  -- {"frequence":"mois","intervalle":1,"jour":5,
  --  "delai_nb":5,"delai_unite":"jour"}
  -- delai_nb / delai_unite = à partir de quand la carte apparaît sur le board.
  recurrence        jsonb,

  cree_par          uuid references public.membres(id) on delete set null,
  cree_le           timestamptz not null default now(),
  termine_par       uuid references public.membres(id) on delete set null,
  termine_le        timestamptz,
  note_de_cloture   text
);

create index if not exists taches_espace_idx on public.taches (espace_id);
create index if not exists taches_statut_idx on public.taches (espace_id, statut);

-- Les occurrences d'une même tâche récurrente partagent un identifiant de série
-- (recurrence->>'serie'). Les deux téléphones génèrent les occurrences à venir
-- chacun de leur côté ; cet index garantit qu'une même échéance ne peut pas
-- être créée deux fois, même si les deux appareils s'ouvrent en même temps.
create unique index if not exists taches_occurrence_unique
  on public.taches ((recurrence->>'serie'), date_limite)
  where recurrence is not null;

-- ---------------------------------------------------------------------------
--  Module « Courses »
-- ---------------------------------------------------------------------------

create table if not exists public.listes_courses (
  id           uuid primary key default gen_random_uuid(),
  espace_id    uuid not null references public.espaces(id) on delete cascade,
  nom          text not null,
  type         text not null default 'annexe' check (type in ('permanente','annexe')),
  statut       text not null default 'active' check (statut in ('active','cloturee')),
  cree_le      timestamptz not null default now(),
  cloturee_le  timestamptz
);

create index if not exists listes_espace_idx on public.listes_courses (espace_id);

-- Une seule liste permanente par espace, garantie côté base.
create unique index if not exists listes_une_permanente_par_espace
  on public.listes_courses (espace_id) where type = 'permanente';

create table if not exists public.articles_courses (
  id        uuid primary key default gen_random_uuid(),
  liste_id  uuid not null references public.listes_courses(id) on delete cascade,
  -- Redondant avec listes_courses.espace_id, mais indispensable : le temps réel
  -- de Supabase ne sait filtrer que sur une colonne de la table elle-même.
  -- Sans ça, chaque téléphone recevrait les articles de tous les espaces.
  espace_id uuid not null references public.espaces(id) on delete cascade,
  nom       text not null,
  quantite  text,
  rayon     text not null default 'Divers',
  coche     boolean not null default false,
  cree_le   timestamptz not null default now()
);

create index if not exists articles_liste_idx on public.articles_courses (liste_id);
create index if not exists articles_espace_idx on public.articles_courses (espace_id);

-- Dictionnaire apprenant : ne contient QUE les corrections faites par le couple.
-- La liste de base des produits courants vit dans le code (js/rayons.js), ce qui
-- la rend disponible même hors ligne et évite de dupliquer 200 lignes par espace.
create table if not exists public.dictionnaire_rayons (
  id        uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.espaces(id) on delete cascade,
  mot       text not null,
  rayon     text not null,
  unique (espace_id, mot)
);

create index if not exists dico_espace_idx on public.dictionnaire_rayons (espace_id);

-- ---------------------------------------------------------------------------
--  Synchronisation temps réel entre les deux téléphones
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['taches','listes_courses','articles_courses',
                           'membres','dictionnaire_rayons']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- déjà publiée, rien à faire
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------------
--  ⚠️  LIMITE DE SÉCURITÉ ASSUMÉE — voir §4 du cahier des charges.
--
--  Cette v1 n'a pas d'authentification (pas de mot de passe, identification
--  par simple choix du prénom). Postgres n'a donc aucun moyen de vérifier
--  qu'un appelant appartient bien à l'espace qu'il interroge : les règles
--  ci-dessous sont volontairement ouvertes.
--
--  Conséquence concrète : toute personne qui possède l'URL du projet et la clé
--  publishable — toutes deux visibles dans le code source de la page, donc
--  publiques dès que le site est en ligne — peut lire et modifier les données.
--
--  C'est acceptable pour des listes de courses et des tâches ménagères, et
--  c'est le compromis choisi dans le brief. Ce ne le sera plus pour le module
--  Documents (§8) : il faudra une vraie authentification avant de le construire.
-- ---------------------------------------------------------------------------

-- Deux verrous distincts, souvent confondus :
--   • le GRANT dit si le rôle a le droit de toucher la table ;
--   • la policy RLS dit quelles lignes il peut voir ou modifier.
-- Sans GRANT, l'API répond « permission denied for table », quelles que
-- soient les policies. Supabase pose parfois ces droits par défaut, mais pas
-- systématiquement selon la façon dont les tables sont créées : on les pose
-- donc explicitement.
grant usage on schema public to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['espaces','membres','taches','listes_courses',
                           'articles_courses','dictionnaire_rayons']
  loop
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists acces_ouvert_v1 on public.%I', t);
    execute format(
      'create policy acces_ouvert_v1 on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
