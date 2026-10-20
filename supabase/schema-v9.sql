-- ============================================================================
--  Skye — Notifications (Web Push)
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les téléphones abonnés
-- ---------------------------------------------------------------------------
--  Une ligne par téléphone (ou navigateur) qui a accepté les notifications.
--  `endpoint` est l'adresse chez Apple (ou Google, Mozilla) à laquelle on
--  envoie ; `p256dh` et `auth` servent à chiffrer le message pour que seul ce
--  téléphone puisse le lire.
--
--  Chaque ligne est rattachée à son membre, et pas seulement à l'espace : les
--  rappels d'anniversaire partent aux deux, mais une notification à venir —
--  « à toi de jouer », « un mot t'attend » — ne devra viser que l'autre.

create table if not exists public.push_abonnements (
  id                uuid primary key default gen_random_uuid(),
  espace_id         uuid not null references public.espaces(id) on delete cascade,
  membre_id         uuid not null references public.membres(id) on delete cascade,

  endpoint          text not null unique,
  p256dh            text not null,
  auth              text not null,

  appareil          text,                -- le user agent, pour s'y retrouver
  cree_le           timestamptz not null default now(),
  derniere_reussite timestamptz
);

create index if not exists push_abonnements_membre_idx
  on public.push_abonnements (membre_id);

-- Chacun ne gère que ses propres téléphones. L'envoi, lui, se fait avec la
-- clé service_role depuis GitHub Actions, qui passe outre ces règles.

alter table public.push_abonnements enable row level security;
revoke all on public.push_abonnements from anon;
grant select, insert, update, delete on public.push_abonnements to authenticated;

drop policy if exists mes_appareils on public.push_abonnements;
create policy mes_appareils on public.push_abonnements for all to authenticated
  using (
    espace_id = public.mon_espace_id()
    and membre_id in (select id from public.membres where user_id = auth.uid())
  )
  with check (
    espace_id = public.mon_espace_id()
    and membre_id in (select id from public.membres where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
--  Le journal des envois
-- ---------------------------------------------------------------------------
--  Le rappel du matin tourne deux fois (pour suivre l'heure d'été), et GitHub
--  peut relancer un passage. Avant d'envoyer, le script inscrit ici « espace,
--  jour, sorte » : si la ligne existe déjà, c'est que c'est fait, il s'arrête.
--  C'est ce qui garantit qu'on n'est jamais notifié deux fois le même jour.
--
--  Aucune policy : la table est invisible depuis l'app, seul le script y
--  touche.

create table if not exists public.push_envois (
  espace_id  uuid not null references public.espaces(id) on delete cascade,
  jour       date not null,
  sorte      text not null,
  cree_le    timestamptz not null default now(),
  primary key (espace_id, jour, sorte)
);

alter table public.push_envois enable row level security;
revoke all on public.push_envois from anon, authenticated;
