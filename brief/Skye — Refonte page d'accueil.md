# Skye — Refonte de la page d'accueil

Ce brief remplace la barre d'onglets basse par une page d'accueil en grille de
cartes. Objectif : rendre la navigation scalable à mesure que de nouveaux
modules arrivent (Jeux/temps à deux, Rangement — pas encore cadrés, hors
scope de ce brief), sans repenser les modules existants.

## Principe

- L'app s'ouvre désormais sur un **écran d'accueil** listant les modules sous
  forme de cartes, **deux par ligne**, dans une grille qui défile
  verticalement si le nombre de cartes dépasse l'écran.
- La **barre d'onglets basse (`nav.tabbar`) disparaît complètement** : elle
  n'est conservée nulle part, ni sur l'accueil ni dans les modules.
- Chaque carte ouvre son module en plein écran, exactement comme aujourd'hui
  (`basculerModule()` dans `js/app.js` reste la fonction qui bascule
  l'affichage — elle change de déclencheur, pas de logique interne).
- Pour revenir à l'accueil depuis un module, une **flèche retour** apparaît
  dans l'en\-tête (`header.topbar`), à gauche du titre du module.
- La grille n'affiche que les modules qui existent aujourd'hui. Pas de carte
  « bientôt » pour les modules futurs : chaque nouveau module ajoutera sa
  propre carte le jour de sa livraison.

## Cartes de la grille (état initial)

| Carte | Module cible | Remarque |
| --- | --- | --- |
| To do | `#vue-taches` | Renommage : le titre affiché passe de « On s'en occupe » à « To do » partout (carte, en\-tête de module, `TITRES_MODULES`) |
| Courses | `#vue-courses` | Inchangé |
| Tricount | `#vue-tricount` | Inchangé |
| Anniversaires | `#vue-anniversaires` | Inchangé |

Chaque carte reprend l'icône déjà utilisée dans l'ancienne barre d'onglets
(✓, 🛒, 💶, 🎂) et le nom du module. Style visuel : cohérent avec la charte
Skye existante (`css/tokens.css`), sans valeur en dur.

## Bandeau « dernier moment à deux »

Au\-dessus de la grille de cartes, un **bandeau dédié** — distinct visuellement
des cartes de modules, traité comme l'information la plus importante de
l'accueil.

- Affiche le nombre de jours écoulés depuis le dernier moment de qualité à
  deux (ex. « 12 jours depuis votre dernier moment à deux »).
- Un bouton permet de le remettre à zéro manuellement (« On vient de passer
  un moment à deux » ou équivalent).
- **Avant d'appliquer le reset, une pop\-up de confirmation** doit apparaître
  (« Confirmer la remise à zéro ? » / Annuler / Confirmer) — pour éviter un
  clic accidentel qui écraserait le compteur.
- Pas de saisie de ce qu'était le moment, pas d'historique : uniquement le
  compteur et son reset. Ce mécanisme est volontairement simple pour ce
  brief — il sera automatisé plus tard (reset déclenché par une action dans
  le futur module Jeux/temps à deux), mais cette automatisation est hors
  scope ici.

## Modèle de données

Un seul champ à ajouter, sur le modèle de `date_mariage_pacs` déjà présent
sur `espaces` (voir `supabase/schema-v2.sql`) :

```sql
-- supabase/schema-v5.sql
alter table public.espaces
  add column if not exists dernier_moment_a_deux timestamptz not null default now();
```

- Un seul champ par espace (pas par membre) : le compteur est partagé par le
  couple, comme le solde Tricount.
- Valeur par défaut à `now()` pour que les espaces existants ne se
  retrouvent pas avec un compteur à une date arbitraire dans le passé au
  moment de la migration.
- Pas de nouvelle politique RLS à écrire : la table `espaces` a déjà une
  politique de mise à jour pour les membres authentifiés de l'espace
  (`espaces_maj`, dans `schema-v2.sql`) — le reset passe par un simple
  `update` sur ce champ, comme le fait déjà la modification des dates dans
  Réglages.

## Comportement détaillé

1. **Au démarrage / après connexion**, l'app affiche l'écran d'accueil
   (nouvelle vue, ex. `#vue-accueil`) plutôt que directement `#vue-taches`.
2. **Clic sur une carte** → `basculerModule(nom)` s'exécute comme
   aujourd'hui, affiche le module en plein écran, masque l'accueil.
3. **Clic sur la flèche retour** dans l'en\-tête du module → masque le
   module, réaffiche l'accueil (et met à jour le bandeau décompte, qui doit
   rester à jour en cas de reset effectué entre\-temps sur un autre appareil,
   via le rechargement temps réel déjà en place dans `app.js`).
4. **Réglages (⚙)** reste accessible depuis l'en\-tête, aussi bien sur
   l'accueil que dans un module.

## Ce qui ne change pas

- Aucun module existant n'est modifié dans son fonctionnement interne
  (`js/taches.js`, `js/courses.js`, `js/tricount.js`, `js/anniversaires.js`
  restent intacts).
- La feuille modale, les toasts, l'authentification : inchangés.

## Hors scope de ce brief

- Le module Jeux/temps à deux et le module Rangement (pas encore cadrés).
- L'automatisation du reset du décompte par une action dans un autre module.
- Les notifications (rappels d'anniversaires, notif mensuelle) — sujet
  technique à part, à cadrer séparément.
