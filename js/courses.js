// Module « Courses » (§7 du cahier des charges).

import {
  $, el, vider, montrer, toast, ouvrirFeuille, fermerFeuille, confirmer, groupeOptions, formaterDate,
} from './ui.js';
import { etat, listeParId, listePermanente } from './etat.js';
import { RAYONS, classer, normaliser, decouper, extraireQuantite, grouperParRayon } from './rayons.js';
import * as db from './db.js';

const VUE_HISTORIQUE = 'historique';

const listesActives = () => etat.listes
  .filter((l) => l.statut === 'active')
  .sort((a, b) => (a.type === 'permanente' ? -1 : b.type === 'permanente' ? 1 : a.cree_le.localeCompare(b.cree_le)));

const listesCloturees = () => etat.listes
  .filter((l) => l.statut === 'cloturee')
  .sort((a, b) => (b.cloturee_le || b.cree_le).localeCompare(a.cloturee_le || a.cree_le));

/** Garantit que `etat.listeActiveId` pointe sur quelque chose d'affichable. */
function normaliserSelection() {
  if (etat.listeActiveId === VUE_HISTORIQUE) {
    if (listesCloturees().length) return;
    etat.listeActiveId = null;
  }
  const courante = listeParId(etat.listeActiveId);
  if (!courante || courante.statut !== 'active') {
    const perm = listePermanente();
    etat.listeActiveId = (perm || listesActives()[0] || {}).id || null;
  }
}

// ══════════════════ Rendu ══════════════════

export function rendreCourses() {
  normaliserSelection();
  rendreOnglets();

  const hote = vider($('#contenu-courses'));
  const enHistorique = etat.listeActiveId === VUE_HISTORIQUE;
  montrer($('#barre-ajout'), !enHistorique);
  montrer($('#filtres-courses'), !enHistorique);

  if (enHistorique) { rendreHistorique(hote); return; }

  const liste = listeParId(etat.listeActiveId);
  if (!liste) {
    hote.append(el('p', { class: 'liste-vide' }, el('strong', {}, 'Aucune liste'), 'Créez-en une pour démarrer.'));
    return;
  }

  if (liste.type === 'annexe') {
    hote.append(el('div', { class: 'bandeau' },
      el('span', {}, 'Liste ponctuelle'),
      el('button', { class: 'btn-lien', onclick: () => cloturerListe(liste) }, 'Clôturer la liste'),
    ));
  }

  const deLaListe = etat.articles.filter((a) => a.liste_id === liste.id);
  const articles = etat.filtreCourses === 'a_acheter'
    ? deLaListe.filter((a) => !a.coche)
    : deLaListe;

  if (!articles.length) {
    hote.append(videAdapte(deLaListe.length));
    return;
  }

  for (const [rayon, lot] of grouperParRayon(articles)) {
    hote.append(el('p', { class: 'rayon-titre' }, rayon));
    for (const a of lot) hote.append(ligneArticle(a));
  }
}

/** Une liste vide et une liste dont tout est coché ne disent pas la même chose :
 *  la première attend qu'on la remplisse, la seconde annonce une bonne nouvelle. */
function videAdapte(nbTotal) {
  if (nbTotal && etat.filtreCourses === 'a_acheter') {
    return el('p', { class: 'liste-vide' },
      el('strong', {}, 'Rien à racheter'),
      'Tout est coché. Décochez ce qui vient à manquer, ou passez sur « Tout » pour voir l’inventaire complet.');
  }
  return el('p', { class: 'liste-vide' },
    el('strong', {}, 'Liste vide'),
    'Ajoutez un article ci-dessous. La dictée du clavier fonctionne : « du lait, des œufs et du pain ».');
}

function rendreOnglets() {
  const hote = vider($('#onglets-listes'));

  for (const l of listesActives()) {
    hote.append(el('button', {
      class: `puce ${etat.listeActiveId === l.id ? 'on' : ''}`,
      onclick: () => { etat.listeActiveId = l.id; rendreCourses(); },
    }, l.nom));
  }

  hote.append(el('button', { class: 'puce puce-ajout', onclick: ouvrirNouvelleListe }, '+ Liste'));

  if (listesCloturees().length) {
    hote.append(el('button', {
      class: `puce ${etat.listeActiveId === VUE_HISTORIQUE ? 'on' : ''}`,
      onclick: () => { etat.listeActiveId = VUE_HISTORIQUE; rendreCourses(); },
    }, 'Historique'));
  }
}

function ligneArticle(a) {
  return el('div', { class: `article ${a.coche ? 'est-coche' : ''}` },
    el('button', {
      class: `case ${a.coche ? 'on' : ''}`,
      'aria-label': a.coche ? `${a.nom} : marquer à racheter` : `${a.nom} : marquer comme en stock`,
      'aria-pressed': String(Boolean(a.coche)),
      onclick: () => basculer(a),
    }),
    el('span', { class: 'nom' }, a.nom),
    a.quantite ? el('span', { class: 'qte' }, a.quantite) : null,
    el('button', {
      class: 'ranger', 'aria-label': `Options de ${a.nom}`,
      onclick: () => ouvrirMenuArticle(a),
    }, '⋯'),
  );
}

function rendreHistorique(hote) {
  const closes = listesCloturees();
  if (!closes.length) {
    hote.append(el('p', { class: 'liste-vide' }, el('strong', {}, 'Rien dans l’historique'),
      'Les listes ponctuelles clôturées apparaîtront ici.'));
    return;
  }
  hote.append(el('p', { class: 'rayon-titre' }, 'Listes clôturées'));
  for (const l of closes) {
    hote.append(el('div', { class: 'article' },
      el('span', { class: 'nom' }, l.nom,
        el('span', { class: 'sous-ligne' }, `Clôturée le ${formaterDate(l.cloturee_le || l.cree_le)}`)),
      el('button', { class: 'btn-lien', onclick: () => ouvrirDuplication(l) }, 'Dupliquer'),
    ));
  }
}

// ══════════════════ Actions sur les articles ══════════════════

/**
 * Bascule l'état de l'article. La case ne veut plus dire « acheté, on l'efface »
 * mais « on en a » : la ligne reste, et se décoche le jour où le produit vient
 * à manquer. Sous le filtre « À acheter », cocher la fait donc disparaître de
 * la vue sans la retirer de l'inventaire.
 *
 * L'état est inversé à l'écran avant la réponse de la base : dans un magasin,
 * la latence rendrait le geste hésitant. Il est remis en place si l'écriture
 * échoue.
 */
async function basculer(a) {
  const vise = !a.coche;
  a.coche = vise;
  rendreCourses();
  try {
    await db.majArticle(a.id, { coche: vise });
  } catch (e) {
    a.coche = !vise;
    rendreCourses();
    toast(`Impossible d’enregistrer : ${e.message}`);
  }
}

/** Décoche un article déjà présent — utilisé quand on le ressaisit à la barre
 *  d'ajout, ce qui veut dire « il en faut », pas « crée un doublon ». */
async function decocher(a) {
  if (!a.coche) return;
  a.coche = false;
  try {
    await db.majArticle(a.id, { coche: false });
  } catch {
    a.coche = true;   // le rendu qui suit l'appel remettra la ligne comme il faut
  }
}

function ouvrirMenuArticle(a) {
  const choix = groupeOptions(RAYONS.map((r) => ({ cle: r, libelle: r })), a.rayon, {
    vert: true,
    onChange: async (rayon) => {
      fermerFeuille();
      try {
        const maj = await db.majArticle(a.id, { rayon });
        const i = etat.articles.findIndex((x) => x.id === a.id);
        if (i !== -1) etat.articles[i] = maj;

        // Le dictionnaire apprend : la prochaine fois, ce mot ira direct au bon rayon.
        const mot = normaliser(a.nom);
        if (mot) {
          await db.apprendreRayon(etat.espaceId, mot, rayon);
          etat.dico.set(mot, rayon);
        }
        rendreCourses();
        toast(`« ${a.nom} » ira désormais en ${rayon}`);
      } catch (e) {
        toast(`Impossible de changer le rayon : ${e.message}`);
      }
    },
  });

  // Retirer définitivement est une action de plein droit, et non un recours
  // caché sous le choix du rayon : la liste étant devenue un inventaire, elle
  // récupère au passage des produits ponctuels qui n'ont rien à y faire.
  const retirer = async () => {
    fermerFeuille();
    const oui = await confirmer(`Retirer « ${a.nom} » ?`, {
      detail: 'L’article disparaît de la liste, coché ou non. Rien d’autre n’est touché.',
      texteOk: 'Retirer', danger: true,
    });
    if (!oui) return;
    const memoire = etat.articles;
    etat.articles = etat.articles.filter((x) => x.id !== a.id);
    rendreCourses();
    try {
      await db.supprimerArticle(a.id);
    } catch (e) {
      etat.articles = memoire;
      rendreCourses();
      toast(`Suppression impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, a.nom),
    el('button', { class: 'btn btn-secondaire', onclick: () => { fermerFeuille(); basculer(a); } },
      a.coche ? 'Marquer à racheter' : 'Marquer comme en stock'),
    el('button', { class: 'btn btn-destructif', onclick: retirer }, 'Retirer de la liste'),

    el('div', { class: 'separateur' }),
    el('p', { class: 'feuille-info' },
      'Dans quel rayon le ranger ? Le choix est mémorisé pour les prochaines fois.'),
    choix,
  ));
}

/** Ajoute un ou plusieurs articles depuis le texte de la barre du bas. */
export async function ajouterDepuisTexte(texte) {
  const liste = listeParId(etat.listeActiveId);
  if (!liste || liste.statut !== 'active') { toast('Choisissez d’abord une liste active'); return; }

  const morceaux = decouper(texte);
  if (!morceaux.length) return;

  const dejaLa = new Map(etat.articles
    .filter((a) => a.liste_id === liste.id)
    .map((a) => [normaliser(a.nom), a]));

  const aInserer = [];
  let doublons = 0;
  let reveilles = 0;
  for (const morceau of morceaux) {
    const { nom, quantite } = extraireQuantite(morceau);
    const cle = normaliser(nom);
    if (!cle) continue;

    const existant = dejaLa.get(cle);
    if (existant) {
      // Ressaisir un produit déjà là veut dire « il en faut » : on le décoche
      // plutôt que d'annoncer un doublon ou d'en créer un second.
      if (existant.coche) { await decocher(existant); reveilles++; } else { doublons++; }
      continue;
    }
    dejaLa.set(cle, null);
    aInserer.push({
      liste_id: liste.id,
      espace_id: etat.espaceId,
      nom,
      quantite,
      rayon: classer(nom, etat.dico),
    });
  }

  const bilan = (n) => [
    n ? `${n} ajouté${n > 1 ? 's' : ''}` : '',
    reveilles ? `${reveilles} à racheter` : '',
    doublons ? `${doublons} déjà là` : '',
  ].filter(Boolean).join(' · ');

  if (!aInserer.length) {
    rendreCourses();
    toast(bilan(0) || 'Rien à ajouter');
    return;
  }

  try {
    const crees = await db.ajouterArticles(aInserer);
    etat.articles.push(...crees);
    rendreCourses();
    toast(bilan(crees.length));
  } catch (e) {
    rendreCourses();
    toast(`Impossible d’ajouter : ${e.message}`);
  }
}

// ══════════════════ Listes annexes ══════════════════

function ouvrirNouvelleListe() {
  const nom = el('input', { type: 'text', placeholder: 'Week-end entre amis', maxlength: 40 });

  const creer = async () => {
    const valeur = nom.value.trim();
    if (!valeur) { toast('Donnez un nom à la liste'); nom.focus(); return; }
    try {
      const liste = await db.creerListe(etat.espaceId, valeur);
      etat.listes.push(liste);
      etat.listeActiveId = liste.id;
      fermerFeuille();
      rendreCourses();
      toast('Liste créée');
    } catch (e) {
      toast(`Impossible de créer la liste : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Nouvelle liste ponctuelle'),
    el('p', { class: 'feuille-info' },
      'Pour un événement précis. Une fois les courses faites, vous la clôturerez — elle restera consultable et duplicable.'),
    el('label', { class: 'champ' }, el('span', {}, 'Nom de la liste'), nom),
    el('button', { class: 'btn btn-primaire', onclick: creer }, 'Créer la liste'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
  setTimeout(() => nom.focus(), 120);
}

async function cloturerListe(liste) {
  const restants = etat.articles.filter((a) => a.liste_id === liste.id && !a.coche).length;
  const oui = await confirmer(`Clôturer « ${liste.nom} » ?`, {
    detail: restants
      ? `${restants} article${restants > 1 ? 's' : ''} non coché${restants > 1 ? 's' : ''} y ${restants > 1 ? 'restent' : 'reste'}. La liste partira dans l’historique et restera duplicable.`
      : 'Elle partira dans l’historique et restera duplicable.',
    texteOk: 'Clôturer',
  });
  if (!oui) return;

  try {
    const maj = await db.majListe(liste.id, { statut: 'cloturee', cloturee_le: new Date().toISOString() });
    const i = etat.listes.findIndex((l) => l.id === liste.id);
    if (i !== -1) etat.listes[i] = maj;
    etat.listeActiveId = null;
    rendreCourses();
    toast('Liste clôturée');
  } catch (e) {
    toast(`Impossible de clôturer : ${e.message}`);
  }
}

function ouvrirDuplication(source) {
  const nom = el('input', { type: 'text', value: source.nom, maxlength: 40 });

  const dupliquer = async () => {
    const valeur = nom.value.trim();
    if (!valeur) { toast('Donnez un nom à la liste'); return; }
    try {
      const articles = await db.articlesDeListe(source.id);
      const liste = await db.creerListe(etat.espaceId, valeur);
      etat.listes.push(liste);

      if (articles.length) {
        const copies = await db.ajouterArticles(articles.map((a) => ({
          liste_id: liste.id,
          espace_id: etat.espaceId,
          nom: a.nom,
          quantite: a.quantite,
          rayon: a.rayon,
        })));
        etat.articles.push(...copies);
      }

      etat.listeActiveId = liste.id;
      fermerFeuille();
      rendreCourses();
      toast(`${articles.length} article${articles.length > 1 ? 's' : ''} repris`);
    } catch (e) {
      toast(`Duplication impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Dupliquer la liste'),
    el('p', { class: 'feuille-info' },
      'Une nouvelle liste active sera créée avec les mêmes articles, tous décochés.'),
    el('label', { class: 'champ' }, el('span', {}, 'Nom de la nouvelle liste'), nom),
    el('button', { class: 'btn btn-primaire', onclick: dupliquer }, 'Dupliquer'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}
