# Skye — Refonte du module Courses en 4 magasins

Ce brief remplace l'écran Courses actuel (liste unique groupée par rayon, avec
cases à cocher et barre d'ajout en bas) par un tableau de bord à quatre
encadrés, un par enseigne, dont le contenu s'écrit et s'efface à la main comme
dans une application de notes.

Demande d'origine : Dom veut « une page vide où on peut remplir à notre
guise », et une vue d'ensemble des quatre destinations de courses sur un seul
écran.

## Principe

- La **liste permanente** ne se présente plus comme une liste : c'est une
  **grille de 4 encadrés**, deux par ligne, un par magasin.
- Chaque encadré montre un **aperçu tronqué** de son contenu. Le nombre total
  de produits est affiché en tête de l'encadré, et un dégradé en bas de la
  liste signale qu'elle continue au-delà de ce qu'on voit.
- **Toucher un encadré l'ouvre en pleine page**, où toute la liste se lit et
  s'édite.
- On peut **ajouter un produit depuis les deux endroits** : depuis la grille,
  directement dans l'encadré visé, et depuis la page pleine.
- Les **listes ponctuelles ne changent pas de structure** : une liste simple
  d'un seul bloc, sans découpage par magasin. Un pique-nique ne se répartit pas
  par enseigne.

## Ce qui disparaît

Trois mécanismes sont retirés, à la demande expresse : Dom veut quelque chose
de très simple, « que du texte » qu'on écrit et qu'on supprime à la main.

1. **Les cases à cocher**, et avec elles la logique d'inventaire livrée au
   chantier précédent (coché = on en a). Une ligne présente veut désormais dire
   une seule chose : *il faut l'acheter*. Une fois acheté, on efface la ligne.
   Le filtre « À acheter / Tout » n'a plus d'objet et disparaît.
2. **Les rayons** (Crèmerie, Fruits & légumes…) et le dictionnaire qui
   apprenait les corrections. Le magasin remplace le rayon, et il est choisi
   par le geste : on ajoute *dans* un encadré, il n'y a donc rien à deviner.
   `js/rayons.js` est supprimé.
3. **Le découpage de la dictée et l'extraction de quantité.** « du lait, des
   œufs et du pain » ne crée plus trois lignes, et « 500 g de farine » ne
   remplit plus un champ quantité séparé : ce qui est tapé ou dicté devient la
   ligne, mot pour mot. C'est le comportement d'une note — on y dit « nouvelle
   ligne » pour passer à la suivante. Conséquence assumée de la simplification,
   facile à réintroduire si l'usage le réclame.

La **barre d'ajout en bas de l'écran** disparaît elle aussi : on écrit
directement dans l'encadré ou dans la page pleine.

## Les quatre magasins

Par défaut : **Grand Frais**, **Monoprix**, **Pharmacie**, **Autres**.

- **Toujours exactement quatre**, pour que la grille 2×2 reste stable et qu'il
  n'y ait aucun écran de gestion à construire.
- **Renommables** depuis les Réglages ⚙, par quatre champs texte. Renommer ne
  déplace aucun produit : les lignes restent dans leur case, qui change juste
  d'étiquette.
- Les noms sont stockés sur l'espace, donc partagés par le couple et
  synchronisés entre les deux téléphones.

## Modèle de données (`supabase/schema-v6.sql`)

```sql
alter table public.espaces
  add column if not exists magasins text[] not null
    default array['Grand Frais', 'Monoprix', 'Pharmacie', 'Autres'];

alter table public.articles_courses
  add column if not exists magasin smallint;   -- 0 à 3, index dans espaces.magasins
```

- `magasin` est un **index**, pas un nom : renommer « Monoprix » en « Carrefour »
  ne doit pas orphaliner les produits qui s'y trouvaient.
- `magasin` est **nul pour les articles d'une liste ponctuelle**, qui ne
  connaissent pas les magasins. C'est ce qui distingue les deux affichages.
- Aucune politique RLS nouvelle : les deux tables ont déjà les leurs.

### Colonnes devenues inutiles

`articles_courses.coche`, `.quantite` et `.rayon`, ainsi que toute la table
`dictionnaire_rayons`, ne sont plus lues ni écrites par l'app. **Elles ne sont
pas supprimées** : leurs valeurs par défaut permettent aux insertions de
continuer à fonctionner, et garder les colonnes rend le changement réversible
sans perte. Un ménage pourra se faire plus tard, une fois la nouvelle version
éprouvée.

### Reprise de l'existant

Les produits déjà saisis dans la liste permanente portent un rayon, pas un
magasin. Le script de migration applique la règle suivante :

- Les articles **non cochés** — c'est-à-dire ce qui restait à racheter — passent
  dans **« Autres »** (index 3). À vous de les redistribuer dans les bons
  encadrés, ce qui se fait en quelques secondes.
- Les articles **cochés** — « on en a », donc rien à acheter — gardent un
  `magasin` nul et **cessent simplement d'apparaître**. Dans le nouveau modèle,
  une ligne signifie « à acheter » : les afficher noierait la liste sous des
  produits déjà en stock.

Rien n'est effacé : ces lignes restent en base. Une seule requête suffirait à
les faire réapparaître si la décision se révélait mauvaise.

## Écran 1 — la grille (liste permanente)

```
┌───────────────────────────────┐
│ ←  Courses                 ⚙  │
│ [Permanente]  Pique-nique  +  │
├───────────────┬───────────────┤
│ GRAND FRAIS 8 │ MONOPRIX    4 │
│ tomates       │ lait          │
│ pommes        │ café          │
│ salade        │ riz           │
│ ▒fraises▒▒▒▒▒ │ papier toil.  │
│ + Ajouter     │ + Ajouter     │
├───────────────┼───────────────┤
│ PHARMACIE   1 │ AUTRES        │
│ doliprane     │ Rien pour     │
│               │ l'instant     │
│ + Ajouter     │ + Ajouter     │
└───────────────┴───────────────┘
```

- La grille occupe toute la hauteur disponible, chaque encadré prenant un
  quartier de l'écran. Elle ne défile pas : c'est une vue d'ensemble.
- Le **titre de l'encadré** porte le nom du magasin et, à droite, le nombre
  total de produits qu'il contient — c'est lui qui dit la vérité quand
  l'aperçu est coupé.
- Quand la liste dépasse la hauteur de l'encadré, un **dégradé** ferme le bas
  de l'aperçu. Il n'apparaît qu'après mesure : jamais à tort.
- Toucher l'encadré **ailleurs que sur « + Ajouter »** l'ouvre en pleine page.
- **« + Ajouter »** fait apparaître un champ de saisie au bas de l'encadré,
  déjà focalisé. Entrée enregistre la ligne et **laisse le champ ouvert** pour
  la suivante : on peut enchaîner plusieurs produits sans rien retoucher.
  Le champ se referme sur Échap, ou en le quittant vide.
- Un encadré vide affiche une invite discrète plutôt que du blanc.

## Écran 2 — un magasin en pleine page

```
┌───────────────────────────────┐
│ ←  Grand Frais             ⚙  │
├───────────────────────────────┤
│ tomates                     × │
│ pommes                      × │
│ salade                      × │
│ |                             │
└───────────────────────────────┘
```

- **Une ligne = un champ de saisie**, éditable sur place : on touche le mot,
  on le corrige, c'est enregistré en quittant la ligne. C'est nouveau — il est
  aujourd'hui impossible de renommer un article sans le supprimer.
- **Entrée** crée la ligne suivante et y place le curseur. On saisit donc toute
  une liste sans jamais lâcher le clavier.
- **Une ligne vidée de son texte est supprimée** en la quittant, comme dans une
  note. Idem pour Retour arrière sur une ligne déjà vide, qui remonte le
  curseur à la ligne précédente.
- Un **×** à droite de chaque ligne la supprime, sans confirmation : c'est le
  geste courant une fois le produit acheté, et redemander à chaque fois serait
  insupportable. Le texte effacé tient en trois mots.
- Une **ligne vide en attente** est toujours présente en bas : la page ne
  demande jamais où cliquer pour écrire.
- La flèche de retour ramène à la grille des quatre magasins, pas à l'accueil
  de l'app.

## Ce qui ne change pas

- Les onglets **Permanente / listes ponctuelles / + Liste / Historique**,
  la création, la clôture, la duplication et la suppression d'une liste
  ponctuelle : inchangés.
- La synchronisation temps réel entre les deux téléphones : inchangée. Chaque
  ligne reste un enregistrement distinct, ce qui fait que deux saisies
  simultanées fusionnent d'elles-mêmes — c'est précisément ce qu'un unique bloc
  de texte partagé ne saurait pas faire.
- Les autres modules, l'authentification, la charte graphique.

## Hors scope

- Le réordonnancement manuel des lignes par glisser-déposer. Les produits
  s'affichent dans l'ordre où ils ont été saisis.
- Un nombre de magasins différent de quatre.
- La reprise des rayons sous une autre forme.
