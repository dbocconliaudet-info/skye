// Module « Courses ».
//
// La liste permanente se présente en quatre encadrés, un par enseigne ; les
// listes ponctuelles restent d'un seul bloc. Dans les deux cas, une ligne est
// un champ de saisie qu'on édite sur place : ni case à cocher, ni formulaire,
// ni rayon — on écrit et on efface à la main, comme dans une note.
//
// Une ligne présente veut donc dire une seule chose : il faut l'acheter.

import {
  $, el, vider, montrer, toast, ouvrirFeuille, fermerFeuille, confirmer, formaterDate,
} from './ui.js';
import { etat, listeParId, listePermanente } from './etat.js';
import { MAGASINS_DEFAUT, NB_MAGASINS } from './config.js';
import * as db from './db.js';

const VUE_HISTORIQUE = 'historique';

/** Le nom affiché d'un encadré. Les noms vivent sur l'espace et se renomment
 *  dans les Réglages ; ceux du code ne servent que de secours, le temps qu'un
 *  espace créé avant la migration relise l'espace. */
export const nomMagasin = (i) => etat.magasins[i] || MAGASINS_DEFAUT[i] || `Magasin ${i + 1}`;

const listesActives = () => etat.listes
  .filter((l) => l.statut === 'active')
  .sort((a, b) => (a.type === 'permanente' ? -1 : b.type === 'permanente' ? 1 : a.cree_le.localeCompare(b.cree_le)));

const listesCloturees = () => etat.listes
  .filter((l) => l.statut === 'cloturee')
  .sort((a, b) => (b.cloturee_le || b.cree_le).localeCompare(a.cloturee_le || a.cree_le));

/**
 * Les produits d'une liste, dans l'ordre de saisie.
 *
 * `magasin` vaut l'index de l'encadré pour la liste permanente, et `null` pour
 * une liste ponctuelle, qui ignore les enseignes et s'affiche d'un bloc. Un
 * article de la permanente resté sans magasin — les anciens articles cochés,
 * que la migration a laissés de côté — n'apparaît nulle part : dire « à
 * acheter » n'aurait aucun sens pour un produit qu'on avait en stock.
 */
const articlesDe = (listeId, magasin) => etat.articles
  .filter((a) => a.liste_id === listeId && (magasin === null || a.magasin === magasin))
  .sort((a, b) => a.cree_le.localeCompare(b.cree_le));

/** Garantit que `etat.listeActiveId` pointe sur quelque chose d'affichable. */
function normaliserSelection() {
  if (etat.listeActiveId === VUE_HISTORIQUE) {
    if (listesCloturees().length) { etat.magasinOuvert = null; return; }
    etat.listeActiveId = null;
  }
  const courante = listeParId(etat.listeActiveId);
  if (!courante || courante.statut !== 'active') {
    const perm = listePermanente();
    etat.listeActiveId = (perm || listesActives()[0] || {}).id || null;
  }
  // Seule la permanente connaît les encadrés : ailleurs, aucun n'est ouvert.
  const liste = listeParId(etat.listeActiveId);
  if (!liste || liste.type !== 'permanente') etat.magasinOuvert = null;
}

// ══════════════════ Rendu différé pendant la saisie ══════════════════

// Le temps réel recharge tout et redessine à chaque changement venu de l'autre
// téléphone. Redessiner pendant que quelqu'un tape lui arracherait son champ
// sous les doigts — et le clavier avec. On repousse donc le rendu jusqu'à ce
// que la saisie se termine.

let renduEnAttente = false;

const saisieEnCours = () => {
  const a = document.activeElement;
  return Boolean(a && a.classList.contains('ligne-produit') && $('#vue-courses').contains(a));
};

/** Appelé quand un champ perd le focus. Le `setTimeout` laisse le focus
 *  s'installer ailleurs — sur la ligne suivante, par exemple — avant de
 *  décider si l'on peut redessiner sans rien interrompre. */
function rendreSiLibre() {
  setTimeout(() => { if (renduEnAttente && !saisieEnCours()) rendreCourses(); }, 0);
}

let focusOutBranche = false;
function brancherFocusOut() {
  if (focusOutBranche) return;
  focusOutBranche = true;
  $('#contenu-courses').addEventListener('focusout', rendreSiLibre);
}

// ══════════════════ Rendu ══════════════════

export function rendreCourses() {
  if (saisieEnCours()) { renduEnAttente = true; return; }
  renduEnAttente = false;
  brancherFocusOut();

  normaliserSelection();
  rendreOnglets();
  majTitre();

  // Un magasin ouvert prend tout l'écran : les onglets des listes n'ont plus
  // rien à y faire, on y revient par la flèche de l'en-tête.
  montrer($('#onglets-listes'), etat.magasinOuvert === null);

  const hote = vider($('#contenu-courses'));

  if (etat.listeActiveId === VUE_HISTORIQUE) {
    hote.dataset.vue = 'histo';
    rendreHistorique(hote);
    return;
  }

  const liste = listeParId(etat.listeActiveId);
  if (!liste) {
    hote.dataset.vue = 'histo';
    hote.append(el('p', { class: 'liste-vide' }, el('strong', {}, 'Aucune liste'), 'Créez-en une pour démarrer.'));
    return;
  }

  if (liste.type === 'permanente' && etat.magasinOuvert === null) {
    hote.dataset.vue = 'grille';
    for (let i = 0; i < NB_MAGASINS; i += 1) hote.append(carteMagasin(liste, i));
    // Une fois la grille entière posée, et pas avant : un aperçu encore
    // détaché du document ne se mesure pas.
    for (const apercu of hote.querySelectorAll('.apercu')) mesurerApercu(apercu);
    return;
  }

  hote.dataset.vue = 'page';
  if (liste.type !== 'permanente') {
    hote.append(el('div', { class: 'bandeau' },
      el('span', {}, 'Liste ponctuelle'),
      el('button', { class: 'btn-lien', onclick: () => cloturerListe(liste) }, 'Clôturer la liste'),
    ));
  }
  hote.append(listeEditable(liste, liste.type === 'permanente' ? etat.magasinOuvert : null));
}

/** Le titre de l'en-tête suit la sous-navigation du module. Rien à faire quand
 *  un autre module est à l'écran : le rendu tourne aussi en arrière-plan, à
 *  chaque rechargement, et écraserait son titre. */
function majTitre() {
  if (etat.module !== 'courses') return;
  $('#titre-module').textContent = etat.magasinOuvert === null
    ? 'Courses'
    : nomMagasin(etat.magasinOuvert);
}

/** Retour depuis l'en-tête. Renvoie `true` si le module a consommé le geste —
 *  refermer un magasin ramène à la grille, pas à l'accueil de l'app. */
export function retourCourses() {
  if (etat.magasinOuvert === null) return false;
  // Une ligne encore en cours de saisie bloquerait le rendu — c'est tout
  // l'objet du garde-fou ci-dessus. On termine donc la saisie d'abord, ce qui
  // enregistre la ligne au passage, avant de redessiner la grille.
  if (saisieEnCours()) document.activeElement.blur();
  etat.magasinOuvert = null;
  rendreCourses();
  return true;
}

function rendreOnglets() {
  const hote = vider($('#onglets-listes'));

  const aller = (id) => { etat.listeActiveId = id; etat.magasinOuvert = null; rendreCourses(); };

  for (const l of listesActives()) {
    hote.append(el('button', {
      class: `puce ${etat.listeActiveId === l.id ? 'on' : ''}`,
      onclick: () => aller(l.id),
    }, l.nom));
  }

  hote.append(el('button', { class: 'puce puce-ajout', onclick: ouvrirNouvelleListe }, '+ Liste'));

  if (listesCloturees().length) {
    hote.append(el('button', {
      class: `puce ${etat.listeActiveId === VUE_HISTORIQUE ? 'on' : ''}`,
      onclick: () => aller(VUE_HISTORIQUE),
    }, 'Historique'));
  }
}

// ══════════════════ La grille des quatre encadrés ══════════════════

/**
 * Marque l'aperçu qui déborde, pour que le dégradé du bas apparaisse.
 *
 * Mesuré de façon synchrone, et non dans un `requestAnimationFrame` : celui-ci
 * ne se déclenche pas tant que l'onglet est en arrière-plan, et le dégradé
 * manquait alors à l'appel. Quatre cartes à mesurer, le coût est nul.
 */
function mesurerApercu(apercu) {
  if (!apercu.isConnected) return;   // pas encore posée : la grille la mesurera
  apercu.classList.toggle('tronque', apercu.scrollHeight > apercu.clientHeight + 1);
}

function carteMagasin(liste, magasin) {
  const apercu = el('ul', { class: 'apercu' });
  const compte = el('span', { class: 'carte-compte' });
  const zoneAjout = el('div', { class: 'carte-ajout' });

  const rafraichir = () => {
    const produits = articlesDe(liste.id, magasin);
    compte.textContent = produits.length ? String(produits.length) : '';
    vider(apercu);
    if (!produits.length) {
      apercu.append(el('li', { class: 'apercu-vide' }, 'Rien pour l’instant'));
    } else {
      for (const a of produits) apercu.append(el('li', {}, a.nom));
    }
    mesurerApercu(apercu);
  };

  zoneAjout.append(boutonAjout(zoneAjout, liste, magasin, rafraichir));
  rafraichir();

  return el('div', {
    class: 'carte-magasin',
    // Toucher la carte l'ouvre — sauf au pied, où l'on écrit sans la quitter.
    onclick: (e) => { if (!e.target.closest('.carte-ajout')) ouvrirMagasin(magasin); },
  },
  el('div', { class: 'carte-tete' },
    el('button', {
      class: 'carte-titre', type: 'button',
      onclick: () => ouvrirMagasin(magasin),
    }, nomMagasin(magasin)),
    compte),
  apercu,
  zoneAjout,
  );
}

function ouvrirMagasin(magasin) {
  etat.magasinOuvert = magasin;
  rendreCourses();
  // Le premier champ libre attend déjà : on ouvre la page prête à écrire,
  // sans donner le focus — sur iPhone, le clavier surgissant à l'ouverture
  // masquerait la liste qu'on vient précisément d'ouvrir pour la lire.
  $('#contenu-courses').scrollTop = 0;
}

function boutonAjout(zone, liste, magasin, rafraichir) {
  return el('button', {
    class: 'btn-ajout', type: 'button',
    onclick: () => ouvrirSaisieCarte(zone, liste, magasin, rafraichir),
  }, '+ Ajouter');
}

/** Champ de saisie au pied d'un encadré, pour ajouter sans quitter la grille.
 *  Il reste ouvert après chaque Entrée : on enchaîne les produits d'affilée. */
function ouvrirSaisieCarte(zone, liste, magasin, rafraichir) {
  const champ = el('input', {
    type: 'text', class: 'ligne-produit ajout', placeholder: 'Un produit…',
    enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'sentences',
    'aria-label': `Ajouter dans ${nomMagasin(magasin)}`,
  });

  // Échap et la perte du focus referment tous deux le champ : un drapeau
  // évite que le second geste ne rouvre ce que le premier vient de ranger.
  let ferme = false;
  const refermer = () => {
    if (ferme) return;
    ferme = true;
    vider(zone).append(boutonAjout(zone, liste, magasin, rafraichir));
  };

  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); champ.value = ''; refermer(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const nom = champ.value.trim();
    // Vidé sur-le-champ, sans lâcher le focus : le clavier de l'iPhone reste
    // ouvert et la ligne suivante s'enchaîne.
    champ.value = '';
    if (nom) ajouter(nom, liste, magasin, rafraichir);
  });

  champ.addEventListener('blur', () => {
    const nom = champ.value.trim();
    if (nom) ajouter(nom, liste, magasin, rafraichir);
    refermer();
  });

  vider(zone).append(champ);
  champ.focus();
}

async function ajouter(nom, liste, magasin, rafraichir) {
  try {
    const cree = await db.creerArticle({
      liste_id: liste.id, espace_id: etat.espaceId, nom, magasin,
    });
    etat.articles.push(cree);
    rafraichir();
  } catch (e) {
    toast(`Impossible d’ajouter : ${e.message}`);
  }
}

// ══════════════════ La liste éditable ══════════════════

/**
 * La page d'un magasin, ou une liste ponctuelle : des champs de saisie
 * empilés, plus une ligne vierge qui attend toujours en bas. Rien n'y est
 * jamais redessiné en cours de frappe — les lignes se créent, se renomment et
 * se suppriment une par une, directement dans le DOM.
 */
function listeEditable(liste, magasin) {
  const boite = el('div', { class: 'lignes' });
  for (const a of articlesDe(liste.id, magasin)) boite.append(ligne(a, liste, magasin, boite));
  boite.append(ligne(null, liste, magasin, boite));
  return boite;
}

function ligne(article, liste, magasin, boite) {
  const champ = el('input', {
    type: 'text', class: 'ligne-produit',
    value: article ? article.nom : '',
    placeholder: article ? '' : 'Ajouter…',
    enterkeyhint: 'enter', autocomplete: 'off', autocapitalize: 'sentences',
    'aria-label': 'Produit',
  });
  if (article) champ.dataset.id = article.id;

  // La ligne d'attente ne montre pas de croix : il n'y a rien à y effacer, et
  // une croix sur une ligne vide ne voudrait rien dire.
  const rangee = el('div', { class: article ? 'rangee' : 'rangee vierge' }, champ,
    el('button', {
      class: 'btn-effacer', type: 'button',
      'aria-label': article ? `Supprimer ${article.nom}` : 'Supprimer cette ligne',
      // Aucune confirmation : effacer une ligne est le geste courant une fois
      // le produit acheté, et redemander à chaque fois serait intenable. Ce
      // qu'on perd tient en trois mots.
      onclick: () => effacerRangee(rangee, boite, liste, magasin),
    }, '×'));

  champ.addEventListener('keydown', (e) => gererTouche(e, rangee, boite, liste, magasin));
  champ.addEventListener('blur', () => enregistrerLigne(rangee, boite, liste, magasin));
  return rangee;
}

function gererTouche(e, rangee, boite, liste, magasin) {
  const champ = e.target;

  if (e.key === 'Escape') { champ.blur(); return; }

  if (e.key === 'Enter') {
    e.preventDefault();
    // La ligne suivante est créée et focalisée de façon synchrone, dans le
    // geste même de l'utilisateur : un focus() décalé après un `await` ne
    // rouvrirait pas le clavier sur iPhone.
    let suivante = rangee.nextElementSibling;
    if (!suivante) {
      suivante = ligne(null, liste, magasin, boite);
      boite.append(suivante);
    }
    suivante.querySelector('.ligne-produit').focus();
    return;
  }

  // Retour arrière sur une ligne déjà vide : elle disparaît et le curseur
  // remonte à la fin de la précédente, comme dans une note.
  if (e.key === 'Backspace' && champ.value === '') {
    const precedente = rangee.previousElementSibling;
    if (!precedente) return;
    e.preventDefault();
    effacerRangee(rangee, boite, liste, magasin);
    const cible = precedente.querySelector('.ligne-produit');
    cible.focus();
    cible.setSelectionRange(cible.value.length, cible.value.length);
  }
}

/** Enregistre une ligne qu'on vient de quitter : création, renommage, ou
 *  suppression si on l'a vidée de son texte. */
async function enregistrerLigne(rangee, boite, liste, magasin) {
  if (rangee.dataset.supprimee) return;

  const champ = rangee.querySelector('.ligne-produit');
  const nom = champ.value.trim();
  const id = champ.dataset.id || '';

  if (!id) {
    if (!nom) return;
    champ.value = nom;
    try {
      const cree = await db.creerArticle({
        liste_id: liste.id, espace_id: etat.espaceId, nom, magasin,
      });
      etat.articles.push(cree);
      champ.dataset.id = cree.id;
      champ.placeholder = '';
      rangee.classList.remove('vierge');   // elle porte un produit : la croix a un sens
      garantirLigneVierge(boite, liste, magasin);
    } catch (e) {
      toast(`Impossible d’ajouter : ${e.message}`);
    }
    return;
  }

  const article = etat.articles.find((a) => a.id === id);
  if (!article) return;
  if (!nom) { effacerRangee(rangee, boite, liste, magasin); return; }
  if (nom === article.nom) return;

  champ.value = nom;
  const avant = article.nom;
  article.nom = nom;
  try {
    await db.majArticle(id, { nom });
  } catch (e) {
    article.nom = avant;
    champ.value = avant;
    toast(`Impossible d’enregistrer : ${e.message}`);
  }
}

/** Retire la ligne de l'écran et l'article de la base. Sert aussi bien au «×»
 *  qu'au retour arrière sur une ligne vide. */
function effacerRangee(rangee, boite, liste, magasin) {
  const champ = rangee.querySelector('.ligne-produit');
  const id = champ.dataset.id || '';

  // Posé avant le retrait : ôter la ligne déclenche son `blur`, qui sans ce
  // drapeau irait réenregistrer un article qu'on vient de supprimer.
  rangee.dataset.supprimee = '1';
  rangee.remove();
  garantirLigneVierge(boite, liste, magasin);
  if (!id) return;

  const article = etat.articles.find((a) => a.id === id) || null;
  etat.articles = etat.articles.filter((a) => a.id !== id);
  db.supprimerArticle(id).catch((e) => {
    if (article) etat.articles.push(article);
    toast(`Suppression impossible : ${e.message}`);
    rendreCourses();
  });
}

/** La liste ne reste jamais sans sa ligne d'attente : la page ne doit jamais
 *  obliger à chercher où cliquer pour écrire. */
function garantirLigneVierge(boite, liste, magasin) {
  const derniere = boite.lastElementChild;
  if (derniere && !derniere.querySelector('.ligne-produit').dataset.id) return;
  boite.append(ligne(null, liste, magasin, boite));
}

// ══════════════════ Historique ══════════════════

function rendreHistorique(hote) {
  const closes = listesCloturees();
  if (!closes.length) {
    hote.append(el('p', { class: 'liste-vide' }, el('strong', {}, 'Rien dans l’historique'),
      'Les listes ponctuelles clôturées apparaîtront ici.'));
    return;
  }
  hote.append(el('p', { class: 'histo-titre' }, 'Listes clôturées'));
  for (const l of closes) {
    hote.append(el('div', { class: 'ligne-histo' },
      el('span', { class: 'nom' }, l.nom,
        el('span', { class: 'sous-ligne' }, `Clôturée le ${formaterDate(l.cloturee_le || l.cree_le)}`)),
      el('button', {
        class: 'ranger', 'aria-label': `Options de ${l.nom}`,
        onclick: () => ouvrirMenuListe(l),
      }, '⋯'),
    ));
  }
}

/** Menu d'une liste clôturée. Les deux actions sont rares et l'une est
 *  irréversible : aucune des deux n'a sa place à portée d'un doigt distrait. */
function ouvrirMenuListe(l) {
  const supprimer = async () => {
    fermerFeuille();
    const oui = await confirmer(`Supprimer « ${l.nom} » ?`, {
      detail: 'La liste et les articles qu’elle contenait sont effacés définitivement. '
        + 'Vous ne pourrez plus la dupliquer.',
      texteOk: 'Supprimer', danger: true,
    });
    if (!oui) return;

    const memoireListes = etat.listes;
    const memoireArticles = etat.articles;
    etat.listes = etat.listes.filter((x) => x.id !== l.id);
    // Les articles des listes closes ne sont plus chargés, mais une liste
    // clôturée à l'instant peut encore en avoir en mémoire.
    etat.articles = etat.articles.filter((a) => a.liste_id !== l.id);
    rendreCourses();
    try {
      // Les articles partent avec, par cascade déclarée dans le schéma.
      await db.supprimerListe(l.id);
      toast('Liste supprimée');
    } catch (e) {
      etat.listes = memoireListes;
      etat.articles = memoireArticles;
      rendreCourses();
      toast(`Suppression impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, l.nom),
    el('p', { class: 'feuille-info' },
      `Clôturée le ${formaterDate(l.cloturee_le || l.cree_le)}.`),
    el('button', { class: 'btn btn-secondaire', onclick: () => ouvrirDuplication(l) },
      'Dupliquer cette liste'),
    el('button', { class: 'btn btn-destructif', onclick: supprimer }, 'Supprimer définitivement'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

// ══════════════════ Listes ponctuelles ══════════════════

function ouvrirNouvelleListe() {
  const nom = el('input', { type: 'text', placeholder: 'Week-end entre amis', maxlength: 40 });

  const creer = async () => {
    const valeur = nom.value.trim();
    if (!valeur) { toast('Donnez un nom à la liste'); nom.focus(); return; }
    try {
      const liste = await db.creerListe(etat.espaceId, valeur);
      etat.listes.push(liste);
      etat.listeActiveId = liste.id;
      etat.magasinOuvert = null;
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
      'Pour un événement précis, d’un seul bloc — sans découpage par magasin. '
      + 'Une fois les courses faites, vous la clôturerez : elle restera consultable et duplicable.'),
    el('label', { class: 'champ' }, el('span', {}, 'Nom de la liste'), nom),
    el('button', { class: 'btn btn-primaire', onclick: creer }, 'Créer la liste'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
  setTimeout(() => nom.focus(), 120);
}

async function cloturerListe(liste) {
  const restants = articlesDe(liste.id, null).length;
  const oui = await confirmer(`Clôturer « ${liste.nom} » ?`, {
    detail: restants
      ? `${restants} produit${restants > 1 ? 's' : ''} y ${restants > 1 ? 'restent' : 'reste'}. La liste partira dans l’historique et restera duplicable.`
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
          magasin: a.magasin,
        })));
        etat.articles.push(...copies);
      }

      etat.listeActiveId = liste.id;
      etat.magasinOuvert = null;
      fermerFeuille();
      rendreCourses();
      toast(`${articles.length} produit${articles.length > 1 ? 's' : ''} repris`);
    } catch (e) {
      toast(`Duplication impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Dupliquer la liste'),
    el('p', { class: 'feuille-info' },
      'Une nouvelle liste active sera créée avec les mêmes produits.'),
    el('label', { class: 'champ' }, el('span', {}, 'Nom de la nouvelle liste'), nom),
    el('button', { class: 'btn btn-primaire', onclick: dupliquer }, 'Dupliquer'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}
