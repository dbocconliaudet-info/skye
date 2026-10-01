# Skye — Module « Home team »

Nouveau module, en cinquième carte de l'accueil après Tricount et
Anniversaires — intitulée **« Home team »** : le décompte des heures de la femme de ménage et de la nounou.

## Pourquoi

Damien tient aujourd'hui ce décompte dans un calendrier Excel que **lui seul
remplit**. Le module ne cherche pas à refaire ce que CESU et Pajemploi font
déjà — ni déclaration, ni cotisations, ni brut. Il déplace le calendrier dans
l'app pour trois raisons, et trois seulement :

1. **Dom peut le remplir aussi.** C'est la raison principale.
2. Pas de tableur à ouvrir : l'app est déjà sur l'écran d'accueil du téléphone.
3. Le total du mois se calcule tout seul, au lieu d'être une formule à vérifier.

L'écran doit dire qu'il s'agit d'un **suivi**, pas d'une source de vérité
fiscale : le montant réellement prélevé par Pajemploi diffère toujours un peu
du produit heures × taux, et cet écart ne doit pas passer pour un bug. C'est
d'ailleurs précisément ce que le relevé de paiement (plus bas) sert à garder.

## Ce qui est volontairement exclu

Arbitré avec Damien, et à ne pas réintroduire sans qu'il le redemande :

- **Pas de congés payés.** Le montant calculé est strictement heures × taux.
- **Pas de frais en euros.** Le module ne compte que du temps.
- **Pas de clôture de mois.** Noter un paiement ne verrouille rien : les
  heures d'un mois réglé restent modifiables. On veut une trace, pas un
  cadenas.
- **Pas de lien avec Tricount.**
- Pas de brut, pas de cotisations, pas de majoration (dimanche, fériés, heures
  supplémentaires).

## Navigation

Trois niveaux, sur le modèle déjà en place dans Courses :

```
Accueil  →  Home team          →  Nounou Lucie
            (liste des gens)      (son calendrier)
```

- La carte **Home team** ouvre la **liste des personnes**, avec un bouton
  « Nouvelle personne ».
- Toucher une personne ouvre **sa page**.
- La flèche de l'en-tête referme d'abord la personne, puis ramène à l'accueil
  — exactement comme elle referme un magasin dans Courses avant de quitter le
  module (`retourCourses` dans `js/courses.js` sert de modèle).

## Créer une personne

Une feuille modale demande trois choses :

1. **Le nom** (« Nounou Lucie », « Ménage Maria »).
2. **Le taux horaire net** et sa **date d'effet**.
3. **La semaine type** : sept durées, du lundi au dimanche. Elle sert
   uniquement de modèle de remplissage (voir plus bas) ; on peut la laisser
   vide et la régler plus tard.

## La page d'une personne

Deux onglets : **Calendrier** et **Synthèse**.

### Onglet Calendrier

```
┌────────────────────────────────┐
│ ←  Nounou Lucie                │
│    [Calendrier] Synthèse    ⋯  │
├────────────────────────────────┤
│  ‹    semaine du 28 sept.    › │
│                                │
│  lun. 28           [3 ▾][00 ▾] │
│  mar. 29           [2 ▾][50 ▾] │
│  mer. 30           [— ▾][   ]  │
│  jeu. 1er          [3 ▾][00 ▾] │
│  ven. 2            [2 ▾][00 ▾] │
│  sam. 3            [0 ▾][00 ▾] │
│  dim. 4            [0 ▾][00 ▾] │
│                                │
│  [Semaine type] [Pas travaillé]│
├────────────────────────────────┤
│  septembre 2026   5 h 30   82,50 €│
│  octobre 2026    10 h 00  150,00 €│
└────────────────────────────────┘
```

- **Une durée par jour et par personne**, comme une case du tableau Excel. Si
  la nounou vient matin et soir, on saisit le total de la journée.
- **Deux menus déroulants** par jour : les heures (`—`, puis 0 à 12) et les
  minutes **de 5 en 5** (00, 05, 10 … 55). Ce sont des `<select>` natifs, donc
  le sélecteur habituel de l'iPhone.
- Le pas de 5 minutes, et non le quart d'heure : une journée qui se termine à
  15 h 50 donne une durée qu'un quart d'heure ne sait pas écrire, et arrondir
  fausserait le décompte tous les mois dans le même sens.
- **`—` veut dire « pas encore saisi »**, et ce n'est pas la même chose que
  `0 h 00`, qui veut dire « vérifié, elle n'est pas venue ». Cette distinction
  est tout l'intérêt d'un calendrier de comptage : elle répond à « est-ce que
  j'ai rempli cette semaine ? ». Choisir `—` efface la journée.
- Les flèches `‹ ›` font défiler les semaines. La semaine en cours est celle
  affichée à l'ouverture.
- **Sous le calendrier**, le total des mois que la semaine touche. Une semaine
  à cheval, comme celle du 28 septembre, en affiche **deux lignes** :
  le décompte se fait **jour par jour**, jamais semaine par semaine. Sans ça,
  les mois seraient faux deux fois par an.

### Les deux boutons de la semaine

- **« Semaine type »** remplit les sept jours avec le modèle de la personne, y
  compris les zéros des jours non travaillés. Si la semaine contient déjà des
  saisies, une confirmation prévient avant d'écraser.
- **« Pas travaillé »** met les sept jours à `0 h 00` — pour les vacances
  scolaires. Même confirmation si quelque chose est déjà saisi.

### Onglet Synthèse

```
┌────────────────────────────────┐
│ ←  Nounou Lucie                │
│    Calendrier [Synthèse]    ⋯  │
├────────────────────────────────┤
│  OCTOBRE 2026                  │
│  18 h 30 · calculé 277,50 €    │
│  payé 279,80 € le 3 nov.  +2,30│
│                                │
│  SEPTEMBRE 2026                │
│  22 h 00 · calculé 330,00 €    │
│  [Noter le paiement]           │
│  ⋯                             │
├────────────────────────────────┤
│  TAUX HORAIRE                  │
│  15,00 €/h  1 janv. 25 → 31 août 26│
│  16,00 €/h  depuis le 1er sept. 26│
└────────────────────────────────┘
```

- La liste des mois, du plus récent au plus ancien : heures, **montant
  calculé**, et **montant réellement payé** quand il a été noté.
- L'**écart** entre les deux s'affiche discrètement à côté (`+2,30 €`).
  C'est lui l'information : il est normal, petit, et le voir dérider évite de
  se demander chaque mois si on s'est trompé.
- Un mois sans paiement noté propose **« Noter le paiement »**.
- En bas, **l'historique des taux**. C'est au passage l'historique des
  augmentations.

### Noter un paiement

Une feuille modale, par personne et par mois :

- **Le montant réellement payé** (celui de Pajemploi ou du CESU).
- **La date du paiement.**
- **Une note libre**, facultative — « régularisation congés », « Pajemploi a
  arrondi ». C'est elle qui servira le jour de l'archéologie.

Au moment de l'enregistrement, **le montant calculé est figé dans la ligne de
paiement**, tel qu'il était ce jour-là. Si quelqu'un corrige des heures six
mois plus tard, la ligne reste un témoignage complet : sans ce figement, on
retrouverait un écart sans pouvoir dire s'il vient de Pajemploi ou d'une
retouche faite après coup. La synthèse affiche donc, pour un mois réglé, à la
fois le calcul d'aujourd'hui et celui du jour du paiement s'ils diffèrent.

Un paiement se **modifie et se supprime** : c'est une saisie manuelle, elle a
le droit d'être fausse.

## Les réglages d'une personne

Depuis le bouton **⋯**, à droite des deux onglets de sa page. L'icône ⚙ de
l'en-tête n'est pas disponible : elle appartient aux réglages de l'app.


- **Renommer.**
- **Modifier la semaine type.** La changer ne touche à aucune semaine déjà
  saisie : elle ne fait que changer ce que le bouton proposera la prochaine
  fois. Pas besoin de l'historiser.
- **Nouveau taux horaire** : un montant et une date d'effet. La période
  précédente se referme automatiquement la veille de cette date, et le nouveau
  taux devient le taux en cours. **Les mois déjà passés gardent le taux qui
  s'appliquait à l'époque** — c'est la raison d'être des périodes.
- **Supprimer la personne**, avec confirmation : ses heures, ses taux et ses
  paiements partent avec, par cascade.

## Calcul du montant

Pour un mois donné : pour **chaque jour**, `minutes ÷ 60 × le taux en vigueur
ce jour-là`, puis on additionne, et on arrondit **à la fin seulement**.

Passer par les jours et non par le total mensuel est ce qui rend corrects à la
fois les semaines à cheval et les augmentations qui tombent en milieu de mois.

## Modèle de données (`supabase/schema-v7.sql`)

```sql
create table public.personnels (
  id            uuid primary key default gen_random_uuid(),
  espace_id     uuid not null references public.espaces(id) on delete cascade,
  nom           text not null,
  -- Semaine type en minutes, du lundi au dimanche.
  semaine_type  smallint[] not null default '{0,0,0,0,0,0,0}',
  cree_le       timestamptz not null default now()
);

create table public.personnels_taux (
  id            uuid primary key default gen_random_uuid(),
  espace_id     uuid not null references public.espaces(id) on delete cascade,
  personnel_id  uuid not null references public.personnels(id) on delete cascade,
  taux_cents    integer not null check (taux_cents >= 0),   -- 16 €/h = 1600
  debut         date not null,
  fin           date,          -- nul = taux en cours
  cree_le       timestamptz not null default now()
);

create table public.personnels_heures (
  id            uuid primary key default gen_random_uuid(),
  espace_id     uuid not null references public.espaces(id) on delete cascade,
  personnel_id  uuid not null references public.personnels(id) on delete cascade,
  jour          date not null,
  minutes       smallint not null check (minutes between 0 and 1440),
  cree_le       timestamptz not null default now(),
  unique (personnel_id, jour)
);

create table public.personnels_paiements (
  id              uuid primary key default gen_random_uuid(),
  espace_id       uuid not null references public.espaces(id) on delete cascade,
  personnel_id    uuid not null references public.personnels(id) on delete cascade,
  mois                  date not null,           -- le 1er du mois réglé
  montant_paye_cents    integer not null check (montant_paye_cents >= 0),
  -- Le calcul tel qu'il était au moment de la saisie. Figé exprès.
  montant_calcule_cents integer not null,
  date_paiement         date not null,
  note                  text,
  cree_le               timestamptz not null default now(),
  unique (personnel_id, mois)
);
```

- **Des minutes entières**, jamais des heures décimales : 2 h 50 s'écrit 170.
  Aucun arrondi ne traîne dans la base.
- **Des centimes entiers** pour les montants et le taux, comme tout le reste de
  l'app depuis `schema-v3.sql` : 16 €/h s'écrit 1600. L'arrondi n'intervient
  qu'une fois, au total du mois.
- **`unique (personnel_id, jour)`** permet d'écrire une journée en *upsert*, et
  règle le cas des deux téléphones qui saisissent le même jour : le dernier
  gagne, ce qui est le bon comportement pour un simple nombre. Même principe
  sur `(personnel_id, mois)` pour les paiements.
- `mois` est stocké comme le **1er du mois** : une vraie date, donc triable et
  comparable, sans colonne année/mois séparée à recoller.
- `espace_id` est répété sur les quatre tables, comme sur `articles_courses` :
  le temps réel de Supabase ne sait filtrer que sur une colonne de la table
  elle-même.
- RLS identique aux autres tables de contenu (`espace_id = mon_espace_id()`),
  et les quatre tables rejoignent la publication temps réel.

### Volume de données

Une personne génère jusqu'à 365 lignes d'heures par an. Pour que le
rechargement complet — qui se déclenche à chaque changement venu de l'autre
téléphone — ne grossisse pas indéfiniment, **seuls les 24 derniers mois
d'heures sont chargés**. La synthèse couvre donc deux ans glissants, ce qui
dépasse largement l'usage courant. Les lignes plus anciennes restent en base,
intactes.

Les **paiements, eux, sont tous chargés** : douze lignes par an et par
personne, c'est négligeable, et ce sont justement ceux-là qu'on voudra
consulter longtemps après — c'est tout le propos de l'archéologie.

## Fichiers touchés

| Fichier | Nature |
|---|---|
| `supabase/schema-v7.sql` | nouveau : les quatre tables, RLS, temps réel |
| `js/personnel.js` | nouveau : tout le module |
| `index.html` | nouveau : la vue `#vue-personnel` |
| `js/db.js` | ajouts : chargement et écriture des quatre tables, abonnement |
| `js/etat.js` | ajouts : les données et la sous-navigation du module |
| `js/app.js` | **6 retouches** : l'import, une ligne dans `MODULES`, le chargement, `rendreTout`, `basculerModule`, et la flèche de retour |
| `css/styles.css` | ajouts : liste des personnes, calendrier, synthèse |
| `sw.js` | ajouts : `personnel.js` dans la coquille, version incrémentée |
| `README.md` | mise à jour |

## Hors scope

- Plusieurs créneaux dans une même journée.
- Le verrouillage d'un mois réglé.
- L'archivage d'une personne qui ne travaille plus (on la supprime, ou on la
  laisse).
- L'export du décompte (PDF, tableur).
- Toute notion fiscale : brut, cotisations, crédit d'impôt, déclaration.
