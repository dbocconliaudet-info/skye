# Skye — Renommage de l'application (anciennement "ToDomTaDam")

Ce document est un brief autonome à transmettre à Claude Code. Il couvre uniquement le renommage de l'application. Il ne modifie ni le modèle de données, ni les fonctionnalités (le contenu de `evolutions-v2-todomtadam.md` reste valable et indépendant de ce renommage).

---

## 1. Contexte

Le nom "ToDomTaDam" (contraction de Damien/Dom) fonctionnait bien comme private joke, mais devient un frein si l'app est un jour montrée ou partagée à d'autres couples : trop intime, peu explicite, difficile à retenir/épeler.

Nouveau nom retenu : **Skye**, en référence à l'île de Skye (Écosse). Nom court, universel, poétique, qui garde un ancrage personnel fort sans l'exposer.

Le nom du module de tâches partagées, **"On s'en occupe"**, n'a pas de lien avec le nom de l'app et **reste inchangé**.

---

## 2. Ce qui change

Remplacer **toutes** les occurrences visibles ou techniques de "ToDomTaDam" (et variantes : "TodomTadam", "todomtadam") par **"Skye"**, notamment :

- `manifest.json` : champs `name` et `short_name` → `"Skye"`.
- `<title>` de la page HTML principale.
- Le libellé affiché dans la topbar / écran d'accueil de l'app.
- Le nom affiché lors de l'ajout à l'écran d'accueil iOS (dérivé du `short_name` du manifest — donc automatique une fois le manifest corrigé).
- Tout README, commentaire de code, ou nom de variable qui référence littéralement "todomtadam" en tant que nom de marque (pas besoin de renommer des éléments techniques génériques comme des noms de tables `taches`, `espaces`, etc., qui ne portent pas le nom de l'app).

### Sous-titre d'accroche (proposition)

"Skye" seul est moins auto-explicite que "ToDomTaDam". Proposition : ajouter une petite baseline sous le nom sur l'écran d'accueil, par exemple :

> **Skye** — votre espace à deux

Libre à Damien de l'ajuster ou de la retirer ; ce n'est pas structurant.

---

## 3. Ce qui NE change PAS

- Le modèle de données (tables `espaces`, `membres`, `taches`, `listes_courses`, `articles_courses`, `dictionnaire_rayons`, `messages`) : aucun champ ne porte le nom de l'app, aucun renommage nécessaire côté Supabase.
- Le nom du module "On s'en occupe" et celui du module "Courses".
- La charte graphique (palette coquelicot/liberty, polices Quicksand/Nunito, logo des deux coquelicots entrecroisés) : le renommage ne touche que le texte de la marque, pas l'identité visuelle.

---

## 4. Point d'attention : le nom du dépôt GitHub

Le dépôt GitHub s'appelle probablement `todomtadam`, ce qui détermine l'URL GitHub Pages (`https://<compte>.github.io/todomtadam/`) — donc l'URL de l'app installée sur l'écran d'accueil du téléphone.

Comme l'app n'en est encore qu'au premier "shoot" (pas encore d'usage quotidien réel installé durablement), c'est le bon moment pour renommer proprement plutôt que de garder une URL qui ne correspond plus au nom affiché. Deux options, à trancher par Damien :

1. **Renommer le dépôt** (`todomtadam` → `skye`, dans les paramètres GitHub du dépôt). GitHub redirige automatiquement l'ancienne URL vers la nouvelle pendant un temps, mais l'URL GitHub Pages change bel et bien. Conséquence concrète : il faudra **refaire une fois** "Ajouter à l'écran d'accueil" sur les téléphones (l'icône actuelle pointe vers l'ancienne URL).
2. **Garder le nom technique du dépôt tel quel** et ne renommer que ce qui est visible dans l'app (nom affiché, manifest). Plus simple à court terme, mais l'URL technique restera "todomtadam" indéfiniment (invisible pour l'usage quotidien, visible seulement si quelqu'un regarde l'adresse ou le code source).

Recommandation : option 1, tant que c'est encore facile (avant que l'app soit vraiment installée et utilisée au quotidien par les deux). Mais c'est un arbitrage personnel, pas une nécessité technique.

---

## 5. Instruction à donner telle quelle à Claude Code

> Renomme l'application "ToDomTaDam" en "Skye" partout où le nom apparaît (manifest.json, titre de la page, écran d'accueil, README, commentaires). N'oublie pas le `short_name` du manifest (utilisé par iOS pour l'icône ajoutée à l'écran d'accueil). Ne touche pas au nom du module "On s'en occupe", ni au modèle de données, ni à la charte graphique. Ajoute si possible une petite baseline "Skye — votre espace à deux" sous le nom sur l'écran d'accueil.
