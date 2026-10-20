-- ============================================================================
--  Skye — Guide des tailles : une liste de vêtements par personne
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- Quelle liste de vêtements proposer à chacun : « Chemise » ou « Chemisier »,
-- « Caleçon » ou « Sous-vêtements ». Choisi une fois, dans les réglages ou à
-- la première ouverture du module. Vide tant qu'on n'a pas choisi : l'app
-- affiche alors les deux libellés côte à côte.
--
-- La règle `membres_maj` de schema-v2.sql laisse déjà chacun modifier sa
-- propre ligne, et seulement la sienne : rien à ajouter côté sécurité.

alter table public.membres
  add column if not exists vestiaire text
    check (vestiaire in ('homme', 'femme'));
