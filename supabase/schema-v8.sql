-- ============================================================================
--  Skye — Home team : saisie par heure de début et heure de fin
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les horaires d'une journée
-- ---------------------------------------------------------------------------
--  Saisir « 9 h 00 → 11 h 50 » est plus naturel que de calculer 2 h 50 de
--  tête : c'est ainsi qu'on lit une journée de travail. La durée s'en déduit.
--
--  `minutes` reste pourtant la colonne qui fait foi pour les totaux, et l'app
--  l'écrit en même temps que les horaires. C'est une redondance assumée : les
--  totaux mensuels restent une simple somme d'entiers, sans soustraction
--  d'heures à refaire sur chaque ligne, et une journée sans horaires — « elle
--  n'est pas venue », posée par le bouton « Pas travaillé » — garde un sens.
--
--  Les deux colonnes sont donc nulles ensemble ou remplies ensemble.

alter table public.personnels_heures
  add column if not exists debut time,
  add column if not exists fin   time;

do $$
begin
  alter table public.personnels_heures
    add constraint personnels_heures_horaires_coherents
    check (
      (debut is null and fin is null)
      or (debut is not null and fin is not null and fin >= debut)
    );
exception
  when duplicate_object then null;   -- déjà posée, rien à faire
end $$;

-- ---------------------------------------------------------------------------
--  La semaine type, en horaires elle aussi
-- ---------------------------------------------------------------------------
--  Sept entrées, du lundi au dimanche : soit `null` (jour non travaillé), soit
--  `{"debut": "09:00", "fin": "11:50"}`.
--
--  Une nouvelle colonne plutôt qu'une conversion de `semaine_type` : on ne
--  peut pas inventer une heure de début à partir d'une durée. Les semaines
--  type déjà réglées sont donc à ressaisir une fois — l'affaire de deux
--  minutes, et sans perte puisque `semaine_type` reste en place.

alter table public.personnels
  add column if not exists semaine_type_horaires jsonb not null
    default '[null, null, null, null, null, null, null]'::jsonb;

-- ---------------------------------------------------------------------------
--  Ce qui n'est PAS supprimé
-- ---------------------------------------------------------------------------
--  `personnels.semaine_type`, le tableau de durées en minutes, n'est plus lu
--  par l'app. Il reste en place : sa valeur par défaut laisse les insertions
--  fonctionner, et le garder rend ce changement réversible sans perte.
--
--  Les journées déjà saisies gardent leurs `minutes` et comptent normalement
--  dans les totaux. Elles s'affichent simplement sans horaires, jusqu'à ce
--  qu'on les ressaisisse — l'app le signale ligne par ligne.
