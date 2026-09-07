# Skye — brief d'intégration

Charte complète : `skye-charte-vdef.html` (à ouvrir dans un navigateur).

## Ce que contient ce dossier

- `tokens.css` — toutes les variables CSS (couleurs, typo, espacement, rayons,
  ombres, mouvement), thème clair et sombre.
- `tokens.json` — les mêmes valeurs en données, pour un thème Tailwind ou JS.
- `skye-mark-animated.svg` — l'animation de lancement, autonome (CSS embarqué,
  aucune dépendance). Respecte `prefers-reduced-motion`.
- `skye-mark-animated-circle.svg` — la même en cercle.
- `*.svg` — la marque et l'icône dans leurs déclinaisons.
- `png/` — l'icône déjà découpée aux tailles iOS, Android et favicon.

## Typographie

Deux familles Google Fonts, libres et gratuites :

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
```

- **Fraunces** 600 — le logotype « Skye », et rien d'autre.
- **Plus Jakarta Sans** — toute l'interface, via les variables `--text-*`.

## Règles qui ne se négocient pas

1. Aucune couleur, taille, rayon ou durée en dur : uniquement les variables.
2. `--skye-red` est la couleur d'action et de marque. Elle ne signifie jamais
   « erreur ». Le danger utilise `--danger`, jamais la couleur seule — toujours
   accompagnée d'une icône et d'un libellé.
3. Un seul bouton rouge par écran.
4. Espacement sur la base 4 px (`--space-*`), sans valeur intermédiaire.
5. Le nom n'entre jamais dans l'icône.
6. Le logo ne se redessine pas, ne s'incline pas, ne change pas de couleur.
7. En dessous de 48 px, utiliser `skye-icone-favicon.svg` : son délié est
   épaissi pour survivre à la réduction.

## Le brief à donner à Claude Code

> Voici la charte de Skye, une app d'organisation pour les couples.
>
> Importe `tokens.css` et n'utilise QUE les variables qu'il définit — aucune
> couleur, aucune taille, aucun rayon en dur dans le code.
>
> Typographie : Fraunces est réservée au logotype « Skye ». Tout le reste de
> l'interface est en Plus Jakarta Sans, via les variables `--text-*`.
>
> Couleurs : `--skye-red` est la couleur d'action principale et de marque. Elle
> ne doit jamais signifier une erreur — le danger utilise `--danger`, et n'est
> jamais porté par la couleur seule.
>
> Espacement : base 4 px, via `--space-*`. Aucune valeur intermédiaire.
>
> Thème sombre : géré par les variables, via `prefers-color-scheme`. Ne pas
> écrire de sélecteurs de couleur en double.
>
> Composants attendus : bouton (primaire, secondaire, fantôme, destructif),
> champ, carte, ligne de liste, étiquette, avatar, sélecteur segmenté,
> interrupteur, état vide. Hauteur de bouton 44 px, rayon `--radius-md`,
> graisse 600, un seul bouton rouge par écran.
>
> Assets : le dossier `/brand` contient les SVG et PNG. L'icône applicative est
> `skye-icone-squircle.svg` ; `skye-mark-animated.svg` est l'animation de
> lancement, autonome, à poser telle quelle. Ne pas régénérer ni redessiner le
> logo.
>
> Mouvement : durées et courbes via `--dur-*` et `--ease`. Respecter
> `prefers-reduced-motion`.

## La marque, pour mémoire

Une lemniscate verticale inclinée de 0,20 rad, parcourue d'un seul trait dont
l'épaisseur se module : maximale au centre du S, minimale là où la courbe revient
se refermer. Trois réglages de contraste selon la taille de rendu — 18 → 1,1 au
dessus de 96 px, 17 → 2,6 entre 48 et 96, 16 → 3,8 en dessous. Le halo est un
dégradé radial centré à 34 % / 28 %, rayon 85 %, de #F2624F à #C41C26.
