# ToDomTaDam

Web app privée pour organiser à deux les tâches du quotidien et les courses.
Installable sur l'écran d'accueil d'un téléphone, synchronisée en temps réel
entre les deux membres du foyer.

Cahier des charges complet : [`brief/cahier-des-charges-todomtadam.md`](brief/cahier-des-charges-todomtadam.md).

---

## Mise en route (à faire une seule fois)

### 1. Créer les tables dans Supabase

1. Ouvrir [le tableau de bord Supabase](https://supabase.com/dashboard) → projet **todomtadam**
2. Menu de gauche → **SQL Editor** → **New query**
3. Coller **tout** le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**

Le script est rejouable sans risque : le relancer ne détruit aucune donnée.

### 2. Publier le site sur GitHub Pages

1. Sur GitHub → dépôt `todomtadam` → **Settings** → **Pages**
2. *Source* : **Deploy from a branch**
3. *Branch* : **main**, dossier **/ (root)** → **Save**

Une minute plus tard, l'app est en ligne sur :
`https://dbocconliaudet-info.github.io/todomtadam/`

### 3. Créer l'espace et inviter Dom

1. Ouvrir l'adresse ci-dessus sur ton téléphone
2. **Créer notre espace** → nom du foyer + les deux prénoms
3. Choisir qui tu es
4. Icône **⚙** en haut à droite → **Envoyer le lien d'invitation** → envoyer le lien à Dom par SMS
5. Dom ouvre le lien, choisit son prénom : c'est fait

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
| `js/db.js` | Tous les accès à la base et l'abonnement temps réel |
| `js/etat.js` | État de l'app + session mémorisée sur l'appareil |
| `js/ui.js` | Briques d'interface : feuille modale, toast, dates |
| `js/rayons.js` | Dictionnaire des rayons, découpage de la dictée |
| `js/taches.js` | Module « On s'en occupe » |
| `js/courses.js` | Module « Courses » |
| `js/app.js` | Démarrage, onboarding, navigation |
| `sw.js` + `manifest.json` | Ce qui rend l'app installable |
| `supabase/schema.sql` | Le schéma de base de données |
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

---

## Limite de sécurité, assumée et à connaître

Cette version n'a **pas de mot de passe** : le lien d'invitation est le seul
verrou, comme prévu au §4 du cahier des charges.

Il faut en mesurer la portée exacte. GitHub Pages impose un dépôt public, donc
l'adresse du projet Supabase et sa clé publique sont visibles par n'importe qui.
Sans authentification, la base ne peut pas vérifier qui l'interroge : **toute
personne qui trouve ce dépôt peut lire et modifier vos tâches et vos courses.**

Pour des listes de courses et des tâches ménagères, le compromis se défend.
Il ne tiendra plus dès qu'il s'agira du module Documents (justificatifs, pièces
d'identité, avis d'imposition) : il faudra alors une vraie authentification
avant d'écrire la première ligne de ce module.

Si tu veux relever le niveau dès maintenant, deux pistes, par effort croissant :
rendre le dépôt privé et héberger ailleurs (Netlify, Cloudflare Pages, gratuits
tous les deux), ou ajouter l'authentification Supabase avec un mot de passe par
personne et des règles d'accès qui filtrent par espace.
