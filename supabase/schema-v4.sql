-- ============================================================================
--  ToDomTaDam — module Anniversaires
--
--  À passer APRÈS `schema.sql`, `schema-v2.sql` et `schema-v3.sql`, dans
--  Supabase → SQL Editor → New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les anniversaires
-- ---------------------------------------------------------------------------
--  Le jour, le mois et l'année sont trois colonnes séparées, et non une date.
--  C'est délibéré : pour les amis, on connaît souvent le jour sans l'année, et
--  une colonne `date` obligerait à inventer un millésime. Ces fausses années
--  finissent toujours par ressortir — sous forme d'un « aura 126 ans » le jour
--  où quelqu'un affiche l'âge. Ici, une année absente reste absente.
--
--  Le 29 février est accepté : ces anniversaires-là existent. C'est l'app qui
--  décide où les fêter les années non bissextiles (voir js/anniversaires.js).
-- ---------------------------------------------------------------------------

create table if not exists public.anniversaires (
  id             uuid primary key default gen_random_uuid(),
  espace_id      uuid not null references public.espaces(id) on delete cascade,

  nom            text not null,
  jour           smallint not null check (jour between 1 and 31),
  mois           smallint not null check (mois between 1 and 12),
  annee          smallint check (annee between 1900 and 2200),

  -- Sert à la future notification « pense au cadeau » : elle ne listera que
  -- les personnes ainsi marquées. Sans ce tri, une alerte à deux mois pour
  -- toute la liste deviendrait du bruit, et le bruit se fait couper.
  prevoir_cadeau boolean not null default false,

  note           text,

  cree_par       uuid references public.membres(id) on delete set null,
  cree_le        timestamptz not null default now(),

  -- Interdit le 31 avril ou le 30 février, qu'aucune contrainte de plage ne
  -- rattraperait : `jour` et `mois` sont valides séparément mais pas ensemble.
  constraint anniversaires_jour_valide check (
    jour <= case mois
      when 2 then 29
      when 4 then 30
      when 6 then 30
      when 9 then 30
      when 11 then 30
      else 31
    end)
);

create index if not exists anniversaires_espace_idx
  on public.anniversaires (espace_id, mois, jour);

-- ---------------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------------
--  Même règle que les autres tables de contenu. `mon_espace_id()` vient de
--  schema-v2.sql.

alter table public.anniversaires enable row level security;
revoke all on public.anniversaires from anon;
grant select, insert, update, delete on public.anniversaires to authenticated;

drop policy if exists espace_membre on public.anniversaires;
create policy espace_membre on public.anniversaires for all to authenticated
  using (espace_id = public.mon_espace_id())
  with check (espace_id = public.mon_espace_id());

-- ---------------------------------------------------------------------------
--  Temps réel
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.anniversaires;
  exception
    when duplicate_object then null;   -- déjà publiée, rien à faire
  end;
end $$;

-- Sans ça, un événement DELETE ne transporte que la clé primaire, et Postgres
-- ne peut plus vérifier qui a le droit d'en être informé. Voir schema-v2.sql.
alter table public.anniversaires replica identity full;
