# ToDomTaDam — Évolutions v2

Ce document complète le cahier des charges initial (`cahier-des-charges-todomtadam.md`). Il couvre quatre évolutions à apporter au premier livrable, et **remplace deux limites documentées comme temporaires** dans le brief d'origine : l'absence de mot de passe (§4) et l'absence de Row Level Security.

---

## 1. Authentification réelle (remplace l'identification légère sans mot de passe)

### Principe

Chaque membre possède désormais un vrai compte (email + mot de passe), géré via **Supabase Auth**, à la place du simple choix "Qui es-tu ?" du v1.

### Flux de création et de rejoint

1. Le créateur de l'espace crée d'abord son propre compte : **email, mot de passe, et un pseudo**.
2. Il crée l'espace (nommé librement, ex: "Famille Dupont") et devient son premier membre.
3. Il génère et partage le lien d'invitation, comme prévu dans le brief initial.
4. La personne qui rejoint via ce lien crée à son tour **son propre compte** (email, mot de passe, pseudo), puis rejoint l'espace.

### Le pseudo

À la création du compte, le membre choisit un **pseudo** — c'est ce pseudo, et non son email, qui est affiché partout dans l'app (colonnes du board "On s'en occupe", "assigné à" sur une tâche, auteur d'un message au partenaire, etc.). Il remplace le champ `prenom` prévu dans le modèle de données initial : la table `membres` porte donc un champ `pseudo` (texte, obligatoire, saisi une fois à la création du compte). L'email, lui, ne sert qu'à la connexion et à la récupération de mot de passe — il n'est jamais affiché ailleurs dans l'interface.

### Session et confort d'usage

- La session doit rester active plusieurs mois sur l'appareil (configuration du refresh token / durée de session Supabase), pour éviter d'avoir à se reconnecter à chaque ouverture de l'app.
- **Mot de passe oublié** : flux standard Supabase Auth — chaque membre récupère son mot de passe via un lien envoyé à sa propre adresse email. Pas besoin de connaître l'email de son/sa partenaire pour ça.

### Phase 2 (optionnelle, non prioritaire pour ce livrable)

- Ajout de Face ID / Touch ID via les **passkeys Supabase** (actuellement en beta/expérimental côté Supabase) comme raccourci de connexion sur les sessions suivantes, en complément du mot de passe — pas en remplacement. À ne développer qu'une fois l'authentification par mot de passe stable et éprouvée à l'usage.

### Sécurité — Row Level Security

Une fois l'authentification réelle en place, **activer Row Level Security sur toutes les tables**, avec des politiques basées sur l'appartenance à l'espace : un utilisateur authentifié ne peut lire/écrire que les lignes dont l'`espace_id` correspond à l'espace dont il est membre (via son identifiant Supabase Auth lié à son `membre_id`). Ceci remplace définitivement la limite "pas de RLS" documentée comme temporaire dans le brief initial — ne pas la reporter davantage une fois cette évolution développée.

---

## 2. Dates de naissance et de mariage/PACS

### Modèle de données

- Champ **`date_naissance`** sur chaque membre (`membres`).
- Champ **`date_mariage_pacs`** sur l'espace (`espaces`) — une seule date pour le couple, pas une par membre.
- Les deux champs sont **optionnels**, saisissables à la création (compte ou espace) sans bloquer l'inscription si laissés vides.

### Modification ultérieure

Ajouter dans l'écran **"Paramètres"** une section permettant de modifier ces dates à tout moment (utile en cas d'erreur de saisie initiale).

### Usage futur (hors scope de ce livrable)

Ces dates serviront plus tard à des fonctionnalités non développées pour l'instant (liste de cadeaux, signification du nombre d'années de mariage, etc.). Pour ce livrable, se contenter de stocker proprement les données et de permettre leur saisie/modification.

---

## 3. Filtres d'affichage du board "On s'en occupe"

### Principe

Ajouter un sélecteur **"Regrouper par"** en haut du board, avec trois options :

| Mode | Colonnes affichées |
|---|---|
| Personne (comportement actuel, par défaut) | Damien / Dom / Les deux |
| Catégorie | Une colonne par catégorie, **uniquement celles ayant au moins une tâche** dans la vue active (les catégories vides n'apparaissent pas) |
| Priorité | Basse / Moyenne / Haute |

### Comportement

- Ce sélecteur s'applique de la même façon aux deux onglets existants ("À faire / En cours" et "Historique").
- Le tri des tâches à l'intérieur de chaque colonne reste inchangé (par deadline).
- Les colonnes restent défilantes horizontalement, comme prévu dans le brief initial.

---

## 4. Message au/à la partenaire

### Objectif

Un petit mot doux adressé à son/sa partenaire, qui s'affiche à l'ouverture de l'app — pensé comme un moment de connexion affective ponctuel, pas un fil de discussion.

### Modèle de données

Table **`messages`** :

| Champ | Type | Description |
|---|---|---|
| id | uuid | |
| espace_id | uuid (FK) | |
| auteur_membre_id | référence membre | qui a écrit le message |
| destinataire | référence membre (ou "les deux") | à qui il est adressé |
| contenu | texte | le message |
| lu | booléen | |
| cree_le | timestamp | |

### Comportement

- À l'ouverture de l'app, si un ou plusieurs messages non lus sont adressés au membre actuellement connecté, afficher une **popup** avec le contenu et le nom de l'auteur.
- En fermant la popup (bouton de fermeture ou clic en dehors), le message est marqué comme **lu** et disparaît définitivement.
- **Pas d'historique consultable** : une fois lu, le message n'est plus accessible nulle part dans l'app. C'est volontaire — l'objectif est l'effet de surprise ponctuel, pas un journal de messages.
- Pas d'accusé de réception ni de réponse directe nécessaires pour ce livrable.
