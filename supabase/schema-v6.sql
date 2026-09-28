-- ============================================================================
--  Skye — Courses : quatre magasins à la place des rayons
--
--  À passer APRÈS les scripts précédents, dans Supabase → SQL Editor →
--  New query → Run. Rejouable sans risque.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Les quatre enseignes, portées par l'espace
-- ---------------------------------------------------------------------------
--  Sur l'espace et non sur le membre : les deux téléphones doivent voir les
--  mêmes quatre cases. Toujours quatre, ni plus ni moins — c'est ce qui rend
--  la grille 2×2 stable et évite tout écran de gestion.
--
--  Aucune politique RLS à écrire : `espaces_maj` (schema-v2.sql) couvre déjà
--  la modification de l'espace par ses membres, comme pour les dates.

alter table public.espaces
  add column if not exists magasins text[] not null
    default array['Grand Frais', 'Monoprix', 'Pharmacie', 'Autres'];

-- ---------------------------------------------------------------------------
--  Le magasin d'un article
-- ---------------------------------------------------------------------------
--  Un index (0 à 3) et non un nom : renommer « Monoprix » en « Carrefour » ne
--  doit pas détacher les produits qui s'y trouvaient. Nul pour les articles
--  d'une liste ponctuelle, qui s'affiche d'un seul bloc — c'est cette colonne
--  vide qui distingue les deux présentations.

alter table public.articles_courses
  add column if not exists magasin smallint
    check (magasin is null or magasin between 0 and 3);

create index if not exists articles_magasin_idx
  on public.articles_courses (liste_id, magasin);

-- ---------------------------------------------------------------------------
--  Reprise de l'existant
-- ---------------------------------------------------------------------------
--  Les produits déjà saisis portent un rayon, pas un magasin.
--
--  Les non cochés — ce qui restait à racheter — partent dans « Autres »
--  (index 3), à redistribuer à la main dans les bons encadrés.
--
--  Les cochés voulaient dire « on en a », donc rien à acheter. Les cases à
--  cocher ayant disparu, une ligne ne signifie plus qu'une chose : il faut
--  l'acheter. Les afficher noierait la liste sous des produits déjà en stock.
--  On les laisse donc sans magasin : ils restent en base, intacts, mais ne
--  s'affichent plus.
--
--  Pour les faire revenir, si la décision se révélait mauvaise :
--    update public.articles_courses a set magasin = 3
--      from public.listes_courses l
--     where l.id = a.liste_id and l.type = 'permanente' and a.magasin is null;

update public.articles_courses a
   set magasin = 3
  from public.listes_courses l
 where l.id = a.liste_id
   and l.type = 'permanente'
   and a.coche = false
   and a.magasin is null;

-- ---------------------------------------------------------------------------
--  Ce qui n'est PAS supprimé
-- ---------------------------------------------------------------------------
--  `articles_courses.coche`, `.quantite` et `.rayon`, ainsi que toute la table
--  `dictionnaire_rayons`, ne sont plus lus ni écrits par l'app. Ils restent en
--  place : leurs valeurs par défaut laissent les insertions fonctionner, et
--  garder les colonnes rend ce changement réversible sans perte de données.
--  Le ménage se fera plus tard, une fois la nouvelle version éprouvée.
