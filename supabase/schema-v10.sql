-- ============================================================================
--  Skye — Guide des tailles
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les tailles
-- ---------------------------------------------------------------------------
--  Une ligne = une taille d'une personne, pour un type de vêtement chez une
--  marque : « Dom, Sézane, Robe / Jupe, 38, taille petit ». Le but est de
--  laisser l'autre prendre l'initiative d'un cadeau sans avoir à demander.
--
--  `type` est une clé de la liste de js/config.js (TYPES_VETEMENT). Pas de
--  contrainte en base : allonger la liste ne doit pas demander de script.

create table if not exists public.tailles (
  id          uuid primary key default gen_random_uuid(),
  espace_id   uuid not null references public.espaces(id) on delete cascade,
  membre_id   uuid not null references public.membres(id) on delete cascade,

  marque      text not null check (length(trim(marque)) > 0),
  type        text not null,
  taille      text not null check (length(trim(taille)) > 0),
  precisions  text,

  cree_le     timestamptz not null default now()
);

create index if not exists tailles_espace_idx on public.tailles (espace_id, membre_id);

-- ---------------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------------
--  Lecture : tout l'espace — c'est tout l'intérêt, l'autre doit pouvoir lire.
--  Écriture : chacun ses propres tailles seulement. Ce sont des faits que la
--  personne connaît mieux que quiconque ; l'autre les consulte, il ne les
--  tient pas.

alter table public.tailles enable row level security;
revoke all on public.tailles from anon;
grant select, insert, update, delete on public.tailles to authenticated;

drop policy if exists espace_lecture on public.tailles;
create policy espace_lecture on public.tailles for select to authenticated
  using (espace_id = public.mon_espace_id());

drop policy if exists mes_tailles on public.tailles;
create policy mes_tailles on public.tailles for all to authenticated
  using (
    espace_id = public.mon_espace_id()
    and membre_id in (select id from public.membres where user_id = auth.uid())
  )
  with check (
    espace_id = public.mon_espace_id()
    and membre_id in (select id from public.membres where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
--  Temps réel
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.tailles;
  exception
    when duplicate_object then null;   -- déjà publiée, rien à faire
  end;
end $$;

-- Sans ça, un événement DELETE ne transporte que la clé primaire, et Postgres
-- ne peut plus vérifier qui a le droit d'en être informé. Voir schema-v2.sql.
alter table public.tailles replica identity full;
