-- ============================================================================
--  Skye — Prévenir l'autre quand une tâche est terminée
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- La date de clôture pour laquelle l'autre a déjà été prévenu. Évite un second
-- envoi pour la même clôture ; rouvrir puis refermer la tâche permet de
-- prévenir à nouveau, puisque la date de clôture change.

alter table public.taches
  add column if not exists conjoint_prevenu_pour timestamptz;

-- ---------------------------------------------------------------------------
--  Les droits de la fonction d'envoi
-- ---------------------------------------------------------------------------
--  Ce projet n'accorde pas d'office les droits à service_role : on les donne
--  nommément, au plus juste de ce qu'utilise supabase/functions/prevenir-conjoint.
--  (push_abonnements et membres sont déjà couverts par schema-v9.sql.)

grant select, update on public.taches to service_role;

-- ---------------------------------------------------------------------------
--  Changement de la paire de clés des notifications
-- ---------------------------------------------------------------------------
--  Les téléphones inscrits avec l'ancienne clé ne peuvent plus rien recevoir.
--  On efface leurs lignes : chaque téléphone se réinscrit à l'ouverture de
--  l'app. Rejouer ce script ne casse rien, les lignes se recréent de même.

delete from public.push_abonnements;
