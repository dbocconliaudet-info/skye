# ToDomTaDam

Web app privée pour organiser à deux les tâches du quotidien et les courses.
Installable sur l'écran d'accueil d'un téléphone, synchronisée en temps réel
entre les deux membres du foyer.

Cahier des charges complet : [`brief/cahier-des-charges-todomtadam.md`](brief/cahier-des-charges-todomtadam.md),
puis [`brief/evolutions-v2-todomtadam.md`](brief/evolutions-v2-todomtadam.md) pour la suite.

---

## Mise à jour vers la v2 (comptes et sécurité)

Si l'app tourne déjà avec la version précédente, trois étapes, dans cet ordre.

### 1. Régler l'authentification dans Supabase

Tableau de bord → projet **todomtadam** → **Authentication** :

- **Sign In / Providers → Email** : décocher **Confirm email**. Sans ça, chacun
  devrait aller confirmer son adresse avant de pouvoir entrer — inutile ici,
  et le lien « mot de passe oublié » valide de toute façon l'adresse le jour où
  il sert.
- **Sessions** : allonger la durée de vie du refresh token (**Inactivity
  timeout**) pour ne pas avoir à se reconnecter tous les quatre matins. C'est
  le seul réglage que le code ne peut pas poser lui-même.

### 2. Passer le script SQL

**SQL Editor** → **New query** → coller tout
[`supabase/schema-v2.sql`](supabase/schema-v2.sql) → **Run**.
Rejouable sans risque, comme le premier.

Il fait trois choses : il renomme `prenom` en `pseudo`, il ajoute les comptes,
les dates et les messages, et surtout il **remplace la règle d'accès ouverte de
la v1 par une vraie Row Level Security**. À partir de là, la base ne répond plus
sans session, et chacun ne voit que son propre espace.

### 3. Recréer vos comptes, sans perdre l'historique

Vos deux membres existent déjà en base, mais sans compte. Sur le premier
téléphone : **Rejoindre un espace** → coller le code de l'espace → l'écran
propose **« Je suis Damien »** / **« Je suis Dom »**. En choisissant son nom, on
reprend le membre existant : toutes les tâches déjà créées, y compris
l'historique, restent attachées. Même chose sur le deuxième téléphone avec
l'autre nom.

Le code de l'espace se lit dans l'app, icône ⚙. Si vous n'y avez plus accès :
tableau de bord Supabase → **Table Editor** → `espaces` → colonne
`lien_invitation`.

---

## Mise en route (première installation)

### 1. Créer les tables dans Supabase

1. Ouvrir [le tableau de bord Supabase](https://supabase.com/dashboard) → projet **todomtadam**
2. Menu de gauche → **SQL Editor** → **New query**
3. Coller **tout** le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**
4. Recommencer avec [`supabase/schema-v2.sql`](supabase/schema-v2.sql), et faire
   les réglages d'authentification décrits juste au-dessus

Les scripts sont rejouables sans risque : les relancer ne détruit aucune donnée.

### 2. Publier le site sur GitHub Pages

1. Sur GitHub → dépôt `todomtadam` → **Settings** → **Pages**
2. *Source* : **Deploy from a branch**
3. *Branch* : **main**, dossier **/ (root)** → **Save**

Une minute plus tard, l'app est en ligne sur :
`https://dbocconliaudet-info.github.io/todomtadam/`

### 3. Créer l'espace et inviter Dom

1. Ouvrir l'adresse ci-dessus sur ton téléphone
2. **Créer notre espace** → ton pseudo, ton email, ton mot de passe, puis le nom
   du foyer (les deux dates sont facultatives)
3. Icône **⚙** en haut à droite → **Envoyer le lien d'invitation** → envoyer le lien à Dom par SMS
4. Dom ouvre le lien, crée son compte à son tour : c'est fait

### 4. Installer l'app sur l'écran d'accueil

- **iPhone** : ouvrir le site dans **Safari** (pas Chrome) → bouton Partager → *Sur l'écran d'accueil*
- **Android** : Chrome → menu ⋮ → *Installer l'application*

L'app s'ouvre alors en plein écran, avec les coquelicots en icône.

---

## Faire évoluer l'app

Il n'y a **aucune étape de build** : les fichiers du dépôt sont servis tels
quels par GitHub Pages.

```bash
git pull            # récupérer ce qui a changé
# … modifier les fichiers, avec Claude Code ou à la main …
git add .
git commit -m "Description du changement"
git push            # en ligne ~30 s plus tard
```

Pour essayer une modification avant de la publier, servir le dossier en local :

```bash
python -m http.server 8765
# puis ouvrir http://127.0.0.1:8765/
```

Ouvrir le fichier `index.html` par double-clic **ne marche pas** : les modules
JavaScript exigent un vrai serveur (`http://`, pas `file://`).

---

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de tous les écrans |
| `css/styles.css` | Charte graphique (palette coquelicot & liberty, typos) |
| `js/config.js` | Coordonnées Supabase, listes de catégories et priorités |
| `js/db.js` | Comptes, accès à la base et abonnement temps réel |
| `js/etat.js` | État de l'app en mémoire |
| `js/ui.js` | Briques d'interface : feuille modale, toast, dates |
| `js/rayons.js` | Dictionnaire des rayons, découpage de la dictée |
| `js/taches.js` | Module « On s'en occupe » |
| `js/courses.js` | Module « Courses » |
| `js/app.js` | Démarrage, onboarding, navigation |
| `sw.js` + `manifest.json` | Ce qui rend l'app installable |
| `supabase/schema.sql` | Le schéma de base de données |
| `supabase/schema-v2.sql` | Comptes, Row Level Security, dates, messages |
| `icons/` | Icônes générées depuis l'illustration des coquelicots |

---

## Ce que fait ce premier livrable

**Module « On s'en occupe »**
- Board à 3 colonnes qui défilent : chacun des deux membres + « Les deux »
- Onglets *À faire / En cours* et *Historique* (filtrable Fait / Devenu sans objet)
- Titre, description, catégorie, priorité, échéance, assignation
- Statut à faire → en cours → fait, avec note de clôture, qui et quand
- Tag « devenu sans objet » cumulable avec n'importe quel statut
- Tâches récurrentes (jour / semaine / mois / année) avec délai d'apparition
  réglable tâche par tâche

**Module « Courses »**
- Liste permanente + listes ponctuelles nommées librement
- Cocher fait disparaître l'article immédiatement
- Classement automatique par rayon, avec dictionnaire qui apprend les corrections
- Ajout en texte libre ou par dictée : « du lait, des œufs et du pain » crée
  trois articles ; « 500 g de farine » et « pommes x3 » remplissent la quantité
- Clôture d'une liste ponctuelle, historique consultable, duplication en un geste

Le tout se synchronise en direct entre les deux téléphones.

### Ce qui n'y est pas encore

- **Notifications push.** Le cahier des charges les prévoit (§3), mais elles
  demandent un chantier à part : génération de clés VAPID, Edge Function
  Supabase, tâche planifiée `pg_cron`, stockage des abonnements, et sur iPhone
  elles n'arrivent que si l'app est installée sur l'écran d'accueil. Les
  critères de succès du premier livrable (§10) ne les incluent pas, donc c'est
  reporté au prochain tour. Les tâches récurrentes, elles, fonctionnent :
  chaque occurrence apparaît toute seule à sa date, sans serveur.
- **Module Documents** et **module Agenda** : hors périmètre v1 (§8).
- Des évolutions v2, seuls les **comptes** et la **Row Level Security** sont
  faits. Restent à venir : la modification des dates dans les Réglages, les
  filtres « Regrouper par » du board, et le mot au/à la partenaire.

---

## Où en est la sécurité

Le premier livrable n'avait pas de mot de passe : n'importe qui tombant sur ce
dépôt pouvait lire et modifier les données. **Ce n'est plus le cas.** Depuis
`schema-v2.sql`, chaque personne a un compte, et la base filtre elle-même les
lignes selon l'espace auquel appartient le compte connecté. L'adresse du projet
Supabase et sa clé publique restent visibles dans le code source — c'est normal,
elles sont faites pour ça — mais elles ne donnent plus accès à rien sans
identifiants.

Le seul secret partagé qui subsiste est le code d'invitation : qui le possède
peut voir le nom de l'espace et rejoindre le foyer, tant qu'il reste une place
sur les deux. Une fois les deux membres inscrits, le code ne permet plus rien.

Ce niveau convient à des tâches et des listes de courses, et sert de base
correcte pour la suite. Le module Documents (§8 du cahier des charges) demandera
tout de même son propre passage : chiffrement et contrôle d'accès s'y jugent au
cas par cas, pas par héritage.
