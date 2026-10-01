-- ============================================================================
--  Skye — module « Home team » : décompte des heures du personnel de maison
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les personnes
-- ---------------------------------------------------------------------------
--  `semaine_type` est un modèle de remplissage, en minutes, du lundi au
--  dimanche. Il ne décrit pas un contrat : le modifier ne touche à aucune
--  semaine déjà saisie, il change seulement ce que le bouton « Semaine type »
--  proposera la prochaine fois. D'où l'absence d'historisation, contrairement
--  au taux horaire juste en dessous.

create table if not exists public.personnels (
  id            uuid primary key default gen_random_uuid(),
  espace_id     uuid not null references public.espaces(id) on delete cascade,
  nom           text not null,
  semaine_type  smallint[] not null default '{0,0,0,0,0,0,0}',
  cree_le       timestamptz not null default now(),

  constraint personnels_semaine_type_sept_jours
    check (array_length(semaine_type, 1) = 7)
);

create index if not exists personnels_espace_idx on public.personnels (espace_id);

-- ---------------------------------------------------------------------------
--  Le taux horaire, par périodes
-- ---------------------------------------------------------------------------
--  Et non une colonne unique sur la personne. Une augmentation en cours
--  d'année ne doit pas réécrire les mois déjà passés : chaque jour travaillé
--  se valorise au taux qui avait cours ce jour-là. L'historique des périodes
--  est au passage celui des augmentations, ce qui est demandé.
--
--  `fin` nul désigne le taux en cours. L'app referme la période précédente la
--  veille de la date d'effet de la nouvelle.
--
--  Le taux est en centimes entiers, comme tous les montants de l'app depuis
--  schema-v3.sql : 16 €/h s'écrit 1600. Les nombres à virgule d'un ordinateur
--  ne tombent pas juste, et une dérive d'un centime par mois est indéfendable
--  sur un salaire.

create table if not exists public.personnels_taux (
  id            uuid primary key default gen_random_uuid(),
  espace_id     uuid not null references public.espaces(id) on delete cascade,
  personnel_id  uuid not null references public.personnels(id) on delete cascade,
  taux_cents    integer not null check (taux_cents >= 0),
  debut         date not null,
  fin           date,
  cree_le       timestamptz not null default now(),

  constraint personnels_taux_periode_valide check (fin is null or fin >= debut)
);

create index if not exists personnels_taux_idx
  on public.personnels_taux (personnel_id, debut);

-- ---------------------------------------------------------------------------
--  Les heures travaillées, une ligne par jour
-- ---------------------------------------------------------------------------
--  En minutes entières, jamais en heures décimales : 2 h 50 s'écrit 170, et
--  aucun arrondi ne traîne en base. 1440 = 24 h, borne absurde mais franche.
--
--  L'unicité (personnel, jour) permet d'écrire une journée en upsert, et règle
--  le cas des deux téléphones qui saisissent le même jour : le dernier gagne,
--  ce qui est le bon comportement pour un simple nombre.
--
--  Une journée absente n'est pas une journée à zéro : absente veut dire « pas
--  encore saisie », zéro veut dire « vérifié, elle n'est pas venue ». C'est
--  toute la différence entre un calendrier rempli et un calendrier oublié.

create table if not exists public.personnels_heures (
  id            uuid primary key default gen_random_uuid(),
  espace_id     uuid not null references public.espaces(id) on delete cascade,
  personnel_id  uuid not null references public.personnels(id) on delete cascade,
  jour          date not null,
  minutes       smallint not null check (minutes between 0 and 1440),
  cree_le       timestamptz not null default now(),

  unique (personnel_id, jour)
);

create index if not exists personnels_heures_idx
  on public.personnels_heures (personnel_id, jour);

-- ---------------------------------------------------------------------------
--  Les paiements réellement effectués
-- ---------------------------------------------------------------------------
--  Ce que Pajemploi ou le CESU a prélevé diffère toujours un peu du produit
--  heures × taux. On garde donc les deux montants côte à côte : c'est l'écart
--  qui a de la valeur, pas une coche « payé ».
--
--  `montant_calcule` fige le calcul tel qu'il était au moment de la saisie.
--  Sans ce figement, une correction d'heures faite six mois plus tard
--  laisserait un écart sans qu'on puisse dire s'il vient de l'URSSAF ou de la
--  retouche. La ligne doit rester un témoignage complet.
--
--  `mois` porte le 1er du mois réglé : une vraie date, donc triable et
--  comparable, plutôt qu'un couple année/mois à recoller.
--
--  Noter un paiement ne verrouille rien : les heures du mois restent
--  modifiables. C'est une trace, pas un cadenas.

create table if not exists public.personnels_paiements (
  id                    uuid primary key default gen_random_uuid(),
  espace_id             uuid not null references public.espaces(id) on delete cascade,
  personnel_id          uuid not null references public.personnels(id) on delete cascade,
  mois                  date not null,
  montant_paye_cents    integer not null check (montant_paye_cents >= 0),
  montant_calcule_cents integer not null,
  date_paiement         date not null,
  note                  text,
  cree_le               timestamptz not null default now(),

  unique (personnel_id, mois),
  constraint personnels_paiements_premier_du_mois
    check (date_trunc('month', mois) = mois)
);

create index if not exists personnels_paiements_idx
  on public.personnels_paiements (personnel_id, mois);

-- ---------------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------------
--  Même règle que les autres tables de contenu. `mon_espace_id()` vient de
--  schema-v2.sql.
--
--  `espace_id` est répété sur les quatre tables, y compris celles qui
--  pourraient le déduire de `personnel_id` : le temps réel de Supabase ne sait
--  filtrer que sur une colonne de la table elle-même. Sans cette colonne,
--  chaque téléphone recevrait les événements de tous les espaces.

do $$
declare t text;
begin
  foreach t in array array['personnels', 'personnels_taux',
                           'personnels_heures', 'personnels_paiements']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists espace_membre on public.%I', t);
    execute format(
      'create policy espace_membre on public.%I for all to authenticated '
      || 'using (espace_id = public.mon_espace_id()) '
      || 'with check (espace_id = public.mon_espace_id())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Temps réel
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['personnels', 'personnels_taux',
                           'personnels_heures', 'personnels_paiements']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- déjà publiée, rien à faire
    end;
    -- Sans ça, un événement DELETE ne transporte que la clé primaire, et
    -- Postgres ne peut plus vérifier qui a le droit d'en être informé.
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
