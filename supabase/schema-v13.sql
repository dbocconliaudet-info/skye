-- ============================================================================
--  Skye — Photos des produits (module Courses)
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les photos
-- ---------------------------------------------------------------------------
--  La photo du pot vide, pour racheter le bon produit. Elle est rattachée au
--  NOM du produit, pas à une ligne de liste : la ligne s'efface une fois le
--  produit acheté, la photo doit rester pour la fois suivante.
--
--  `cle` est le nom simplifié par l'app (minuscules, sans accents ni pluriel,
--  sans « de », « la »…) : deux noms de même clé désignent le même produit,
--  d'où une seule photo par clé et par espace. Le fichier lui-même vit dans
--  Storage, sous `chemin`.

create table if not exists public.photos_produits (
  id         uuid primary key default gen_random_uuid(),
  espace_id  uuid not null references public.espaces(id) on delete cascade,
  nom        text not null check (length(trim(nom)) > 0),
  cle        text not null check (length(cle) > 0),
  chemin     text not null,
  cree_par   uuid references public.membres(id) on delete set null,
  cree_le    timestamptz not null default now()
);

create unique index if not exists photos_produits_cle_unique
  on public.photos_produits (espace_id, cle);

alter table public.photos_produits enable row level security;
revoke all on public.photos_produits from anon;
grant select, insert, update, delete on public.photos_produits to authenticated;

drop policy if exists espace_membre on public.photos_produits;
create policy espace_membre on public.photos_produits for all to authenticated
  using (espace_id = public.mon_espace_id())
  with check (espace_id = public.mon_espace_id());

-- Temps réel : une photo prise sur un téléphone apparaît sur l'autre.
do $$
begin
  begin
    alter publication supabase_realtime add table public.photos_produits;
  exception
    when duplicate_object then null;   -- déjà publiée, rien à faire
  end;
end $$;

-- Voir schema-v2.sql : sans ça, un DELETE ne passerait pas le filtre par espace.
alter table public.photos_produits replica identity full;

-- ---------------------------------------------------------------------------
--  Le rangement des fichiers (Storage)
-- ---------------------------------------------------------------------------
--  Un « bucket » privé : aucune adresse publique, chaque lecture passe par la
--  session de l'app. 2 Mo au plus par fichier (l'app envoie environ 150 Ko),
--  JPEG uniquement.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos-produits', 'photos-produits', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Chaque fichier est rangé dans un dossier au nom de l'espace :
-- « <espace_id>/<identifiant>.jpg ». Chacun ne voit et ne touche que le
-- dossier de son propre espace.

drop policy if exists photos_produits_espace on storage.objects;
create policy photos_produits_espace on storage.objects for all to authenticated
  using (
    bucket_id = 'photos-produits'
    and (storage.foldername(name))[1] = public.mon_espace_id()::text
  )
  with check (
    bucket_id = 'photos-produits'
    and (storage.foldername(name))[1] = public.mon_espace_id()::text
  );
