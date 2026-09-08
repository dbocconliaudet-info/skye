-- ============================================================================
--  Skye — page d'accueil : compteur « dernier moment à deux »
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- Un seul champ, sur l'espace et non sur le membre : le compteur appartient au
-- couple, comme le solde de Tricount. `default now()` pour que les espaces
-- existants démarrent à la date de la migration plutôt qu'à une date arbitraire
-- dans le passé, qui afficherait un décompte absurde dès la première ouverture.
alter table public.espaces
  add column if not exists dernier_moment_a_deux timestamptz not null default now();

-- ---------------------------------------------------------------------------
--  Temps réel sur les espaces
-- ---------------------------------------------------------------------------
--  Jusqu'ici, `espaces` était la seule table de contenu absente de la
--  publication : ses trois champs (nom, date de mariage, jeton) ne changent
--  presque jamais, et l'app les relit à chaque rechargement.
--
--  Le compteur, lui, se remet à zéro depuis un téléphone et doit se voir sur
--  l'autre sans attendre. On l'abonne donc.
--
--  Aucune politique RLS à écrire : `espaces_lecture` de schema-v2.sql sert
--  aussi à filtrer les événements temps réel, et le reset passe par
--  `espaces_maj`, déjà en place.

do $$
begin
  begin
    alter publication supabase_realtime add table public.espaces;
  exception
    when duplicate_object then null;   -- déjà publiée, rien à faire
  end;
end $$;

alter table public.espaces replica identity full;
