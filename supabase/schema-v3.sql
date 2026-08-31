-- ============================================================================
--  ToDomTaDam — module Tricount : qui a payé quoi, et qui doit combien
--
--  À passer APRÈS `schema.sql` et `schema-v2.sql`, dans Supabase →
--  SQL Editor → New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les dépenses
-- ---------------------------------------------------------------------------
--  Les montants sont en CENTIMES, dans un entier. Un ordinateur ne sait pas
--  représenter 0,10 € exactement : il stocke un nombre très légèrement à côté,
--  et sur trente dépenses les écarts s'accumulent jusqu'à faire mentir le
--  solde. En centimes entiers, tout est exact — et ce choix-là ne se corrige
--  plus une fois qu'il y a des données.
--
--  Qui supporte la dépense se note comme l'assignation d'une tâche : soit les
--  deux, soit une personne précise. C'est ce qui permet aux trois natures de
--  ligne de partager la même arithmétique :
--
--    • une dépense partagée   → pour_les_deux, chacun en supporte la moitié
--    • « je te l'ai avancé »  → pour_membre = l'autre, il en supporte tout
--    • un remboursement       → idem : je te donne 50 €, tu « supportes » 50 €
--    • le solde repris de Tricount → idem, en une ligne
--
--  Le champ `type` ne sert donc qu'à l'affichage : le calcul du solde, lui,
--  ne le regarde jamais.
-- ---------------------------------------------------------------------------

create table if not exists public.depenses (
  id            uuid primary key default gen_random_uuid(),
  espace_id     uuid not null references public.espaces(id) on delete cascade,

  libelle       text not null,
  montant_cents integer not null check (montant_cents > 0),

  paye_par      uuid references public.membres(id) on delete set null,
  pour_membre   uuid references public.membres(id) on delete set null,
  pour_les_deux boolean not null default true,

  type          text not null default 'depense'
                check (type in ('depense', 'remboursement', 'solde_initial')),

  date_depense  date not null default current_date,
  note          text,

  cree_par      uuid references public.membres(id) on delete set null,
  cree_le       timestamptz not null default now()
);

create index if not exists depenses_espace_idx on public.depenses (espace_id, date_depense desc);

-- Le solde repris de Tricount ne se saisit qu'une fois : deux lignes de
-- reprise fausseraient le solde sans que personne ne comprenne pourquoi.
create unique index if not exists depenses_un_solde_initial_par_espace
  on public.depenses (espace_id) where type = 'solde_initial';

-- ---------------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------------
--  Même règle que les autres tables de contenu : une ligne est à moi si son
--  espace est le mien. `mon_espace_id()` vient de schema-v2.sql.

alter table public.depenses enable row level security;
revoke all on public.depenses from anon;
grant select, insert, update, delete on public.depenses to authenticated;

drop policy if exists espace_membre on public.depenses;
create policy espace_membre on public.depenses for all to authenticated
  using (espace_id = public.mon_espace_id())
  with check (espace_id = public.mon_espace_id());

-- ---------------------------------------------------------------------------
--  Temps réel
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.depenses;
  exception
    when duplicate_object then null;   -- déjà publiée, rien à faire
  end;
end $$;

-- Sans ça, un événement DELETE ne transporte que la clé primaire, et Postgres
-- ne peut plus vérifier qui a le droit d'en être informé : supprimer une
-- dépense ne rafraîchirait pas l'écran d'en face. Voir schema-v2.sql.
alter table public.depenses replica identity full;
