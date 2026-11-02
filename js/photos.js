// Photos des produits (module Courses) : la photo du pot vide, pour racheter
// le bon produit la prochaine fois.
//
// La photo est rattachée au NOM du produit, pas à la ligne : une ligne
// s'efface une fois le produit acheté, la photo doit rester pour la fois
// suivante. Elle réapparaît dès qu'une ligne porte un nom assez proche — on ne
// peut pas exiger de se souvenir de l'orthographe exacte de quinze produits.
//
// Les fichiers vivent dans Supabase Storage (bucket privé « photos-produits »,
// voir supabase/schema-v13.sql), réduits ici à ~150 Ko avant l'envoi.

import { el, toast, ouvrirFeuille, fermerFeuille, confirmer } from './ui.js';
import { etat, pseudoDe } from './etat.js';
import * as db from './db.js';

// Plus grand côté de la photo envoyée, en pixels, et qualité JPEG : de quoi
// lire une étiquette, pour ~150 Ko.
const COTE_MAX = 1200;
const QUALITE = 0.72;

// ══════════════════ Reconnaître un produit ══════════════════

// Des mots qui ne distinguent pas un produit d'un autre.
const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'un', 'une',
  'pour', 'a', 'au', 'aux', 'et', 'en', 'avec', 'sans']);

/** Les mots qui comptent dans un nom, simplifiés : sans majuscules, accents ni
 *  pluriel. « Shampoings d'Élodie » → ['shampoing', 'elodie']. */
export function mots(nom) {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m && !MOTS_VIDES.has(m))
    .map((m) => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m));
}

/** Deux noms de même clé désignent le même produit : une photo par clé. */
export const cleDe = (nom) => mots(nom).join(' ');

/** Nombre de lettres à changer pour passer d'un mot à l'autre. */
function distance(a, b) {
  let avant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const ligne = [i];
    for (let j = 1; j <= b.length; j += 1) {
      ligne.push(Math.min(avant[j] + 1, ligne[j - 1] + 1, avant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    avant = ligne;
  }
  return avant[b.length];
}

/** Deux mots se valent malgré une faute de frappe : une lettre d'écart à partir
 *  de 5 lettres, deux à partir de 9. En dessous, il faut l'égalité : « riz »
 *  et « ris » ne sont pas le même produit. */
function procheMot(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  const tolere = n >= 9 ? 2 : n >= 5 ? 1 : 0;
  return tolere > 0 && Math.abs(a.length - b.length) <= tolere && distance(a, b) <= tolere;
}

const inclus = (petit, grand) => petit.every((m) => grand.some((g) => procheMot(m, g)));

/** Les photos qui vont avec une ligne : le même produit à une faute près, un
 *  nom plus court (« shampoing » propose « shampoing Dom ») ou plus long
 *  (« shampoing Dom bio » propose aussi « shampoing Dom »). */
export function photosPour(nom) {
  const m = mots(nom);
  if (!m.length) return [];
  return etat.photos.filter((p) => {
    const pm = mots(p.nom);
    return pm.length > 0 && (inclus(m, pm) || inclus(pm, m));
  });
}

// ══════════════════ Prendre et envoyer ══════════════════

/** Réduit la photo avant l'envoi : celles de l'iPhone pèsent plusieurs Mo. */
async function reduire(fichier) {
  const adresse = URL.createObjectURL(fichier);
  try {
    const image = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image illisible'));
      i.src = adresse;
    });
    const echelle = Math.min(1, COTE_MAX / Math.max(image.naturalWidth, image.naturalHeight));
    const toile = document.createElement('canvas');
    toile.width = Math.round(image.naturalWidth * echelle);
    toile.height = Math.round(image.naturalHeight * echelle);
    toile.getContext('2d').drawImage(image, 0, 0, toile.width, toile.height);
    return await new Promise((resolve, reject) => toile.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('compression impossible'))), 'image/jpeg', QUALITE));
  } finally {
    URL.revokeObjectURL(adresse);
  }
}

/** Envoie la photo, puis l'inscrit en base. `existante` : la photo qu'elle
 *  remplace, dont l'ancien fichier est alors effacé — rien ne s'accumule. */
async function enregistrer(nom, fichier, existante) {
  const blob = await reduire(fichier);
  const chemin = `${etat.espaceId}/${crypto.randomUUID()}.jpg`;
  await db.envoyerFichierPhoto(chemin, blob);
  try {
    if (existante) {
      const maj = await db.majPhoto(existante.id, { chemin, cree_par: etat.membreId });
      etat.photos = etat.photos.map((p) => (p.id === maj.id ? maj : p));
      db.supprimerFichierPhoto(existante.chemin).catch(() => { /* reste orphelin, sans gravité */ });
    } else {
      const creee = await db.creerPhoto({
        espace_id: etat.espaceId, nom, cle: cleDe(nom), chemin, cree_par: etat.membreId,
      });
      etat.photos.push(creee);
    }
  } catch (e) {
    db.supprimerFichierPhoto(chemin).catch(() => {});
    throw e;
  }
  adresses.set(chemin, URL.createObjectURL(blob));
}

/** Ouvre l'appareil photo (ou la photothèque, au choix de l'iPhone). À appeler
 *  dans le geste même de l'utilisateur, sans `await` avant : sinon iOS refuse
 *  d'ouvrir le sélecteur. */
function choisirEtEnvoyer(nom, existante, apres) {
  const entree = el('input', {
    type: 'file', accept: 'image/*',
    style: 'position:fixed;left:-9999px;opacity:0;',
  });
  entree.addEventListener('change', async () => {
    const fichier = entree.files && entree.files[0];
    entree.remove();
    if (!fichier) return;
    toast('Envoi de la photo…');
    try {
      await enregistrer(nom, fichier, existante);
      toast('Photo enregistrée');
      apres();
    } catch (e) {
      toast(`Photo non enregistrée : ${e.message}`);
    }
  });
  // Dans la page et non détaché : Safari n'ouvre pas toujours un sélecteur
  // de fichier qui n'est pas dans le document.
  document.body.append(entree);
  entree.click();
}

// ══════════════════ Afficher ══════════════════

// Fichier déjà téléchargé → adresse locale, pour ne pas le retélécharger à
// chaque ouverture.
const adresses = new Map();

function image(photo) {
  const img = el('img', { class: 'photo-produit', alt: `Photo : ${photo.nom}` });
  const connue = adresses.get(photo.chemin);
  if (connue) {
    img.src = connue;
  } else {
    db.telechargerPhoto(photo.chemin)
      .then((blob) => {
        const adresse = URL.createObjectURL(blob);
        adresses.set(photo.chemin, adresse);
        img.src = adresse;
      })
      .catch(() => { img.alt = 'Photo introuvable'; });
  }
  return img;
}

/** Les photos d'une ligne, avec de quoi les remplacer ou les supprimer. */
function ouvrirPhotos(nom, apres) {
  const trouvees = photosPour(nom);
  const exacte = trouvees.find((p) => p.cle === cleDe(nom));

  const supprimer = async (p) => {
    const oui = await confirmer(`Supprimer la photo de « ${p.nom} » ?`, {
      detail: 'Elle ne sera plus proposée sur les prochaines listes.',
      texteOk: 'Supprimer', danger: true,
    });
    if (!oui) return;
    try {
      await db.supprimerPhoto(p.id);
      etat.photos = etat.photos.filter((x) => x.id !== p.id);
      db.supprimerFichierPhoto(p.chemin).catch(() => {});
      toast('Photo supprimée');
      apres();
    } catch (e) {
      toast(`Suppression impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, trouvees.length > 1 ? 'Laquelle ?' : trouvees[0].nom),
    trouvees.map((p) => el('div', { class: 'photo-bloc' },
      image(p),
      el('p', { class: 'photo-legende' },
        trouvees.length > 1 ? `${p.nom} · ` : '',
        `photo de ${pseudoDe(p.cree_par) || 'quelqu’un'}`),
      el('div', { class: 'photo-actions' },
        el('button', {
          class: 'btn btn-secondaire',
          onclick: () => { fermerFeuille(); choisirEtEnvoyer(p.nom, p, apres); },
        }, 'Remplacer'),
        el('button', {
          class: 'btn btn-fantome',
          onclick: () => { fermerFeuille(); supprimer(p); },
        }, 'Supprimer'),
      ),
    )),
    exacte ? null : el('button', {
      class: 'btn btn-secondaire',
      onclick: () => { fermerFeuille(); choisirEtEnvoyer(nom, null, apres); },
    }, `Nouvelle photo pour « ${nom} »`),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Fermer'),
  ));
}

/**
 * Le bouton 📷 d'une ligne. Pâle tant qu'aucune photo ne correspond : le
 * toucher ouvre alors l'appareil photo. Vif dès qu'une photo correspond : le
 * toucher la montre. Il suit la saisie, lettre par lettre.
 */
export function boutonPhoto(champ, apres) {
  const bouton = el('button', {
    class: 'btn-photo', type: 'button', 'aria-label': 'Photo du produit',
    onclick: () => {
      const nom = champ.value.trim();
      if (!nom) return;
      if (photosPour(nom).length) ouvrirPhotos(nom, apres);
      else choisirEtEnvoyer(nom, null, apres);
    },
  }, '📷');
  const maj = () => bouton.classList.toggle('a-photo', photosPour(champ.value).length > 0);
  champ.addEventListener('input', maj);
  maj();
  return bouton;
}
