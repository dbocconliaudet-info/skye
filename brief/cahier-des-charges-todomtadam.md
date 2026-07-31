# Cahier des charges — ToDomTaDam

Application partagée pour un couple (Damien &amp; Dom) pour organiser les tâches, la logistique et le foyer à deux.

**Statut du document :** brief complet, prêt à être transmis à Claude Code. Objectif du premier livrable : un "premier shoot" fonctionnel, volontairement simple, pour que Damien puisse commencer à l'utiliser au quotidien puis itérer directement avec Claude Code (nouvelles fonctionnalités, ajustements graphiques, etc.).

---

## 1. Contexte et vision

Damien et sa conjointe Dom veulent une web app privée, installable comme une application sur leurs téléphones (via "Ajouter à l'écran d'accueil", sans passer par l'App Store), pour organiser à deux les tâches du quotidien, du foyer et de la famille.

**Ce n'est pas** un outil généraliste type Notion — pas de gestion de gros projets (organisation d'un voyage), pas de bases de données personnalisables, pas de pages imbriquées. L'app doit couvrir un nombre limité d'usages très concrets et fréquents, avec un accès rapide et une utilisation quotidienne fluide au téléphone.

Cas d'usage déclencheur du projet : ne plus se demander "est-ce qu'on a fait le cadeau de mariage pour tel mariage ?" faute d'avoir tracé qui a fait quoi et quand.

## 2. Identité du produit

- **Nom de l'application :** ToDomTaDam (jeu de mots : Damien + Dom + "to-do" + "tadam !")
- **Nom du module de gestion de tâches :** "On s'en occupe"
- **Logo :** les deux coquelicots entrecroisés (illustration fournie par l'utilisateur, fichier `logo-coquelicots.png` en pièce jointe), symbole du couple. Recadrer en plein cadre (full bleed) pour l'icône d'app, blooms + croisement des tiges visibles, sans marge blanche superflue.
- **Thème graphique :** inspiré des couleurs du mariage de Damien et Dom — coquelicot et liberty.

### Palette de couleurs (validée sur un premier prototype, ajustable ensuite)

| Rôle | Couleur | Hex |
|---|---|---|
| Primaire (actions, accents) | Rouge coquelicot | `#E63946` |
| Primaire foncé | Rouge coquelicot foncé | `#C1272D` |
| Secondaire (validation, "fait") | Vert feuillage | `#588157` |
| Secondaire clair | Vert feuillage clair | `#A3C9A8` |
| Fond | Dégradé blush → ivoire | `#FBE9E4` → `#FDF8F0` |
| Texte | Encre / anthracite | `#3A3A3A` |
| Accent liberty 1 | Bleu doux | `#6C93B8` |
| Accent liberty 2 | Prune | `#9C6B98` |

Les motifs fleuris (liberty) restent réservés à des touches décoratives ponctuelles (écran de bienvenue, petite icône à côté du nom de l'app) — pas de motif en fond continu des listes, pour garder une lisibilité quotidienne.

### Typographie

- Titres / marque : **Quicksand** (rond, chaleureux), poids 500 et 700.
- Texte courant : **Nunito** (lisible, légèrement rond), poids 400/600/700/800.
- Chargées via Google Fonts.

### Prototype visuel de référence

Un prototype HTML statique non-fonctionnel (`apercu-todomtadam.html`, joint) illustre la direction validée : icône avec le vrai logo recadré, fond dégradé blush→ivoire, cartes arrondies, navigation par barre d'onglets en bas. À utiliser comme référence de démarrage pour la charte graphique — pas comme spec figée, Damien ajustera ensuite avec Claude Code.

## 3. Architecture technique

- **Frontend :** PWA (Progressive Web App) — `manifest.json` + service worker minimal, installable via "Ajouter à l'écran d'accueil" sur iOS/Android, ouverture en plein écran sans barre de navigateur.
- **Hébergement :** GitHub Pages, à partir d'un repo GitHub de Damien. Gratuit, déploiement simple.
- **Backend / données :** Supabase (offre gratuite), utilisé directement depuis le frontend via son SDK JavaScript — pas de serveur applicatif à maintenir.
  - Base de données Postgres (voir modèle de données §5)
  - Realtime (synchronisation instantanée entre les deux membres — critique pour la liste de courses et le board de tâches)
  - Edge Functions + `pg_cron` pour les vérifications planifiées (notifications, apparition des tâches récurrentes)
  - Storage (réservé à une phase future — module Documents)
- **Notifications :** Web Push standard (VAPID, gratuit, aucun compte tiers) déclenché par une Edge Function planifiée quotidiennement. Le plan gratuit Supabase inclut 500 000 exécutions de fonctions par mois, très largement suffisant pour un usage à 2 personnes.
  - ⚠️ Note connue : un projet Supabase gratuit se met en pause après 1 semaine d'inactivité totale. L'usage régulier de l'app plus le job quotidien de vérification des notifications devraient suffire à éviter ce cas en pratique.
- **Langue de l'interface :** français.
- **Approche :** mobile-first. L'usage sur ordinateur doit fonctionner mais reste secondaire.

## 4. Structure Espace / Membres

- Un **Espace** représente un foyer (ex: "Famille Dupont"), nommé librement à la création.
- Un Espace contient exactement **2 Membres** pour ce v1 (pas de gestion générique multi-membres pour l'instant — ne pas sur-complexifier). Les deux membres sont créés directement par la personne qui crée l'Espace (ex: "Damien" et "Dom").
- **Rejoindre un espace :** un lien partageable (envoyé par SMS/WhatsApp) permet à l'autre personne de rejoindre l'espace déjà créé. En cliquant sur le lien, elle arrive sur une page "Rejoindre l'espace [Nom]" et choisit son identité parmi les membres déjà créés (pas de création de profil à la volée).
- **Authentification :** pas de mot de passe pour ce v1. Identification légère par choix du membre ("Qui es-tu ?"), mémorisée sur l'appareil. Le lien/code de l'espace est le seul verrou d'accès.
  - ⚠️ Limite de sécurité assumée et documentée : sans mot de passe, toute personne possédant le lien peut rejoindre l'espace. Acceptable pour ce périmètre (aucune donnée sensible stockée en v1). À renforcer impérativement si le module Documents (§8) est développé un jour.

## 5. Modèle de données (vue d'ensemble)

### `espaces`
| Champ | Type | Description |
|---|---|---|
| id | uuid | identifiant unique |
| nom | texte | ex: "Famille Dupont" |
| lien_invitation | texte | token unique pour rejoindre l'espace |
| cree_le | timestamp | |

### `membres`
| Champ | Type | Description |
|---|---|---|
| id | uuid | identifiant unique |
| espace_id | uuid (FK) | espace d'appartenance |
| prenom | texte | ex: "Damien", "Dom" |

### `taches`
| Champ | Type | Description |
|---|---|---|
| id | uuid | identifiant unique |
| espace_id | uuid (FK) | |
| titre | texte | intitulé court |
| description | texte (optionnel) | détail de ce qu'il faut faire |
| assigne_a | référence | un membre précis, ou "les deux" |
| categorie | enum | une seule catégorie parmi la liste §6 |
| priorite | enum | `basse` / `moyenne` / `haute` |
| statut | enum | `a_faire` / `en_cours` / `fait` |
| devenu_sans_objet | booléen | tag indépendant du statut (voir §6) |
| date_limite | date (optionnelle) | deadline |
| recurrence | objet (optionnel) | voir §6.3 |
| cree_par | référence membre | |
| cree_le | timestamp | |
| termine_par | référence membre (optionnel) | |
| termine_le | timestamp (optionnel) | |
| note_de_cloture | texte (optionnel) | mot laissé à la clôture |

### `listes_courses`
| Champ | Type | Description |
|---|---|---|
| id | uuid | |
| espace_id | uuid (FK) | |
| nom | texte | "Liste permanente" (unique, non supprimable) ou nom libre pour une liste annexe |
| type | enum | `permanente` / `annexe` |
| statut | enum | `active` / `clôturée` |
| cree_le | timestamp | |
| cloturee_le | timestamp (optionnel) | |

### `articles_courses`
| Champ | Type | Description |
|---|---|---|
| id | uuid | |
| liste_id | uuid (FK) | |
| nom | texte | |
| quantite | texte (optionnel) | ex: "x2" |
| rayon | texte | déterminé via le dictionnaire de rayons (§7) |
| coche | booléen | si coché → disparaît de l'affichage actif |

### `dictionnaire_rayons` (par espace, apprenant)
| Champ | Type | Description |
|---|---|---|
| id | uuid | |
| espace_id | uuid (FK) | |
| mot | texte | ex: "kombucha" |
| rayon | texte | ex: "Frais" |

Pré-rempli au démarrage avec les produits d'épicerie courants ; enrichi automatiquement à chaque reclassement manuel par les utilisateurs.

## 6. Module "On s'en occupe" — spec détaillée

### 6.1 Champs d'une tâche
- **Titre** (obligatoire)
- **Description / note** (optionnelle) : détail de ce qu'il faut faire
- **Assigné à** : Damien / Dom / Les deux
- **Catégorie** (une seule par tâche) : Admin/Paperasse, Maison, Famille, Amis, Cadeaux &amp; Événements, Vacances, Sport, Loisirs, Santé
- **Priorité** : Basse / Moyenne / Haute (affichée sous forme d'un point de couleur)
- **Deadline** (optionnelle)
- **Récurrence** (optionnelle, voir §6.3)

### 6.2 Statut et cycle de vie
- **Statut** (progression) : à faire → en cours → fait
- **Tag indépendant "devenu sans objet"** : peut être activé à tout moment, quel que soit le statut en cours (y compris sur une tâche déjà "fait" ou encore "à faire"). N'est pas exclusif avec le statut — une tâche peut être "fait" ET taguée "devenu sans objet" en même temps si besoin.
- Au passage à "fait", demander une **note de clôture** optionnelle (ex: "fait le 12/07, offert une carafe") et enregistrer qui l'a clôturée et quand.

### 6.3 Tâches récurrentes
- Une tâche peut être marquée comme récurrente, avec une **fréquence personnalisable** : jour / semaine / mois / année, avec un jour précis si pertinent (ex: "tous les mois, le 5").
- **Délai d'apparition** configurable **tâche par tâche**, exprimé en nombre + unité (ex: "5 jours avant", "1 mois avant") : la carte de la tâche n'apparaît sur le board qu'à partir de ce délai avant la deadline calculée.
- **Chaque occurrence est indépendante** : si une occurrence n'est pas traitée à temps, elle reste affichée en retard, et la nouvelle occurrence apparaît quand même à sa date prévue (pas de blocage de la chaîne de récurrence). Pour retirer une occurrence en retard devenue inutile, on utilise le tag "devenu sans objet".

### 6.4 Affichage et navigation du module
- Deux onglets : **"À faire / En cours"** et **"Historique"** (ce dernier inclut les tâches "fait" et celles taguées "devenu sans objet", filtrables séparément).
- Dans chaque onglet, **3 colonnes qui défilent horizontalement** : Damien / Dom / Les deux.

## 7. Module "Courses"

- **Une liste permanente par défaut**, toujours présente, alimentée sans fin. Cocher un article le fait **disparaître immédiatement** de la liste (pas de zone "acheté" qui traîne).
- **Listes annexes** : possibilité de créer des listes ponctuelles nommées librement (ex: "Week-end entre amis"), pour un événement précis. Une fois les courses faites, la liste est **clôturée manuellement**.
- **Historique des listes annexes clôturées**, consultable, avec un bouton **"Dupliquer cette liste"** pour recréer une nouvelle liste annexe pré-remplie avec les mêmes articles (pratique pour les événements récurrents type week-ends entre amis).
- **Ajout d'un article** : en texte libre, ou via la **dictée vocale déjà intégrée au clavier iPhone** (pas de développement d'un système de reconnaissance vocale propre — on s'appuie sur la fiabilité du clavier natif). L'app découpe le texte dicté en articles séparés (sur les virgules et les "et").
- **Classement automatique par rayon** via le dictionnaire apprenant décrit en §5. En cas de mauvais classement ou d'article inconnu, reclassement manuel simple, mémorisé pour les fois suivantes.
- Pas de fonctionnalité de répartition formelle entre les deux membres pour ce v1 — le classement par rayon suffit pour que chacun sache où aller en magasin.

## 8. Modules reportés à une phase future (hors périmètre v1)

- **Module Documents** : stockage de documents sensibles (justificatif de domicile, pièce d'identité, avis d'imposition). **Point bloquant explicite** : la sécurité doit être spécifiée à part (chiffrement, contrôle d'accès renforcé, potentiellement un vrai système d'authentification avec mot de passe) avant tout développement. Ne pas construire ce module sur les mêmes bases que le reste sans validation explicite du niveau de sécurité attendu.
- **Module Agenda** : simples liens vers les Google Calendar respectifs de Damien et Dom — pas de moteur de calendrier propre à développer.

## 9. Navigation générale de l'app

- **Barre d'onglets en bas de l'écran** (pattern standard mobile), avec deux entrées : **"On s'en occupe"** et **"Courses"**.
- L'app s'ouvre en plein écran une fois installée sur l'écran d'accueil, sans barre de navigateur visible.

## 10. Critères de succès du premier livrable ("premier shoot")

- Damien et Dom peuvent créer leur espace, se rejoindre via le lien d'invitation, et chacun ajouter/assigner/clôturer une tâche depuis son téléphone en moins de 15 secondes.
- L'historique du module "On s'en occupe" permet de répondre sans ambiguïté à une question du type "est-ce qu'on a fait X ?".
- La liste de courses permanente est utilisable au quotidien (ajout rapide, classement par rayon, synchronisation en temps réel entre les deux téléphones).
- L'app s'installe sur l'écran d'accueil et s'ouvre comme une application, avec le logo des deux coquelicots entrecroisés en icône.
- Une fois ce premier socle en place, Damien itère directement avec Claude Code pour ajouter des fonctionnalités, ajuster la charte graphique, et attaquer les phases futures (§8).

## 11. Fichiers à transmettre à Claude Code avec ce document

- Ce cahier des charges (`cahier-des-charges-todomtadam.md`)
- Le prototype visuel de référence (`apercu-todomtadam.html`)
- L'illustration originale du logo (les deux coquelicots entrecroisés)
- Les exemples de palette liberty (photos de la charte graphique du mariage), pour affiner la charte graphique en cours de route si besoin
