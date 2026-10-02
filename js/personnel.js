// Module « Home team » : le décompte des heures du personnel de maison.
//
// Ce module ne refait pas ce que Pajemploi et le CESU font déjà. Il remplace
// le calendrier Excel que Damien tenait seul, pour que Dom puisse le remplir
// aussi — et il additionne les mois tout seul. Le montant affiché est un
// suivi, pas une vérité fiscale : celui réellement prélevé diffère toujours
// un peu, et c'est ce que la ligne de paiement sert à conserver.

import {
  $, el, vider, montrer, toast, ouvrirFeuille, fermerFeuille, confirmer,
  aujourdhui, versIso, depuisIso,
} from './ui.js';
import { etat, personnelParId } from './etat.js';
import { formaterMontant, enCentimes } from './tricount.js';
import * as db from './db.js';

const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

// ══════════════════ Dates ══════════════════

function ajouterJours(iso, n) {
  const d = depuisIso(iso);
  d.setDate(d.getDate() + n);
  return versIso(d);
}

/** Le lundi de la semaine qui contient `iso`. `getDay()` met dimanche à 0 : on
 *  le ramène à 7 pour que la semaine commence le lundi. */
function lundiDe(iso) {
  const d = depuisIso(iso);
  return ajouterJours(iso, 1 - (d.getDay() || 7));
}

const joursDeLaSemaine = (lundi) => Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));

const fmtMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const fmtJourCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtJourAnnee = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

const libelleMois = (mois) => fmtMois.format(depuisIso(`${mois}-01`));

/**
 * Une date avec son année, toujours.
 *
 * `formaterDate` de ui.js omet l'année en cours, ce qui convient à une
 * échéance mais pas ici : un historique de taux traverse les années, et « du
 * 1er janv. 2025 au 31 août » ne veut rien dire. Même raison pour une date de
 * paiement, qu'on relira des années plus tard.
 *
 * Le « 1er » est rattrapé au passage : c'est la seule irrégularité du
 * quantième français, et `Intl` ne la connaît pas.
 */
function dateAvecAnnee(iso) {
  const d = depuisIso(iso);
  const texte = fmtJourAnnee.format(d);
  return d.getDate() === 1 ? texte.replace(/^1 /, '1er ') : texte;
}

// ══════════════════ Durées et horaires ══════════════════

const fmtDecimal = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * Une durée en heures décimales : 2 h 50 s'affiche « 2,83 h ».
 *
 * C'est la forme sous laquelle on recopie des heures sans avoir à les
 * convertir. Le stockage, lui, reste en minutes entières : arrondir à deux
 * décimales sur chaque journée ferait dériver le total du mois.
 *
 * `null` n'est pas zéro : il veut dire « pas encore saisi », quand 0,00 h veut
 * dire « vérifié, elle n'est pas venue ». Toute l'utilité d'un calendrier de
 * comptage tient dans cette différence.
 */
const formaterDuree = (minutes) => (minutes === null || minutes === undefined
  ? '—'
  : `${fmtDecimal.format(minutes / 60)} h`);

/**
 * « 09:00:00 » → « 09:00 ».
 *
 * Postgres rend ses colonnes `time` avec les secondes. Un `<input type="time">`
 * dont le pas est de 5 minutes refuse cette précision et reste vide : la
 * journée passerait pour non saisie alors qu'elle l'est. Tout ce qui vient de
 * la base passe donc par ici.
 */
const hhmm = (valeur) => String(valeur || '').slice(0, 5);

/** « 16:50 » → 1010. Le format des `<input type="time">`, qui couvrent
 *  l'horloge entière : la borne à 12 h n'avait de sens que pour une durée. */
function minutesDeLHeure(texte) {
  const [h, m] = String(texte || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Les deux champs d'une journée : heure de début, heure de fin.
 *
 * `lire()` rend `{ debut, fin, minutes }`, `null` si les deux sont vides, et
 * `'incomplet'` si une seule l'est — un début sans fin ne veut rien dire et ne
 * doit surtout pas s'enregistrer comme une journée de zéro heure.
 */
function champsHoraires(debut, fin, auChangement) {
  const champ = (valeur, etiquette) => el('input', {
    // `step` à 300 secondes : la roulette avance de 5 en 5 minutes, comme les
    // anciens menus. Elle couvre en revanche les 24 heures de l'horloge.
    type: 'time', step: 300, class: 'horaire', value: hhmm(valeur),
    'aria-label': etiquette,
  });
  const chDebut = champ(debut, 'Heure de début');
  const chFin = champ(fin, 'Heure de fin');

  const boite = el('span', { class: 'horaires' },
    chDebut, el('span', { class: 'sep' }, '→'), chFin);

  boite.lire = () => {
    if (!chDebut.value && !chFin.value) return null;
    if (!chDebut.value || !chFin.value) return 'incomplet';
    const d = minutesDeLHeure(chDebut.value);
    const f = minutesDeLHeure(chFin.value);
    if (d === null || f === null) return 'incomplet';
    return { debut: chDebut.value, fin: chFin.value, minutes: f - d };
  };

  if (auChangement) {
    chDebut.addEventListener('change', auChangement);
    chFin.addEventListener('change', auChangement);
  }
  return boite;
}

// ══════════════════ Lecture des données ══════════════════

const heureDuJour = (personnelId, jour) => etat.personnelsHeures
  .find((h) => h.personnel_id === personnelId && h.jour === jour) || null;

const tauxDe = (personnelId) => etat.personnelsTaux
  .filter((t) => t.personnel_id === personnelId)
  .sort((a, b) => a.debut.localeCompare(b.debut));

/** Le taux en vigueur un jour donné, en centimes. Les dates ISO se comparent
 *  comme des chaînes, ce qui évite d'instancier sept `Date` par semaine. */
function tauxAu(personnelId, jour) {
  const periode = tauxDe(personnelId)
    .find((t) => t.debut <= jour && (!t.fin || t.fin >= jour));
  return periode ? periode.taux_cents : 0;
}

const tauxCourant = (personnelId) => tauxDe(personnelId).find((t) => !t.fin) || null;

const paiementDe = (personnelId, mois) => etat.personnelsPaiements
  .find((x) => x.personnel_id === personnelId && x.mois.slice(0, 7) === mois) || null;

/**
 * Heures et montant d'un mois.
 *
 * Le calcul passe par **chaque jour**, au taux qui avait cours ce jour-là, et
 * n'arrondit qu'à la fin. C'est ce qui rend justes à la fois les semaines à
 * cheval sur deux mois et les augmentations tombant en milieu de mois.
 */
function totalDuMois(personnelId, mois) {
  let minutes = 0;
  let cents = 0;
  for (const h of etat.personnelsHeures) {
    if (h.personnel_id !== personnelId || !h.jour.startsWith(mois)) continue;
    minutes += h.minutes;
    cents += (h.minutes * tauxAu(personnelId, h.jour)) / 60;
  }
  return { minutes, cents: Math.round(cents) };
}

/** Les mois à faire figurer dans la synthèse : ceux qui portent des heures, et
 *  ceux qui portent un paiement même sans heures. */
function moisConnus(personnelId) {
  const mois = new Set();
  for (const h of etat.personnelsHeures) {
    if (h.personnel_id === personnelId) mois.add(h.jour.slice(0, 7));
  }
  for (const x of etat.personnelsPaiements) {
    if (x.personnel_id === personnelId) mois.add(x.mois.slice(0, 7));
  }
  return [...mois].sort().reverse();
}

// ══════════════════ Rendu ══════════════════

export function rendrePersonnel() {
  const hote = vider($('#contenu-personnel'));

  // La personne a pu être supprimée depuis l'autre téléphone pendant qu'on la
  // regardait : on retombe alors sur la liste plutôt que sur un écran mort.
  const personne = etat.personnelOuvert ? personnelParId(etat.personnelOuvert) : null;
  if (etat.personnelOuvert && !personne) etat.personnelOuvert = null;

  majTitre(personne);
  montrer($('#onglets-personnel'), Boolean(personne));

  if (!personne) {
    hote.dataset.vue = 'liste';
    rendreListe(hote);
    return;
  }

  if (!etat.lundiAffiche) etat.lundiAffiche = lundiDe(aujourdhui());
  rendreOnglets(personne);

  if (etat.ongletPersonnel === 'synthese') {
    hote.dataset.vue = 'synthese';
    rendreSynthese(hote, personne);
    return;
  }
  if (etat.ongletPersonnel === 'export') {
    hote.dataset.vue = 'export';
    rendreExport(hote, personne);
    return;
  }
  hote.dataset.vue = 'calendrier';
  rendreCalendrier(hote, personne);
}

/** Le titre de l'en-tête suit la sous-navigation. Rien à faire quand un autre
 *  module est à l'écran : le rendu tourne aussi en arrière-plan, à chaque
 *  rechargement, et écraserait son titre. */
function majTitre(personne) {
  if (etat.module !== 'personnel') return;
  $('#titre-module').textContent = personne ? personne.nom : 'Home team';
}

/** Retour depuis l'en-tête. Renvoie `true` si le module a consommé le geste :
 *  refermer une personne ramène à la liste, pas à l'accueil. */
export function retourPersonnel() {
  if (etat.personnelOuvert === null) return false;
  etat.personnelOuvert = null;
  etat.ongletPersonnel = 'calendrier';
  rendrePersonnel();
  return true;
}

function rendreOnglets(personne) {
  const hote = vider($('#onglets-personnel'));
  for (const [cle, libelle] of [
    ['calendrier', 'Calendrier'], ['synthese', 'Synthèse'], ['export', 'Export'],
  ]) {
    hote.append(el('button', {
      class: `puce ${etat.ongletPersonnel === cle ? 'on' : ''}`,
      onclick: () => { etat.ongletPersonnel = cle; rendrePersonnel(); },
    }, libelle));
  }
  // Les réglages d'une personne ne peuvent pas passer par l'icône ⚙ de
  // l'en-tête : elle appartient aux réglages de l'app.
  hote.append(el('button', {
    class: 'puce puce-menu', 'aria-label': `Réglages de ${personne.nom}`,
    onclick: () => ouvrirReglagesPersonne(personne),
  }, '⋯'));
}

// ── La liste des personnes ─────────────────────────────────────────────────

function rendreListe(hote) {
  if (!etat.personnels.length) {
    hote.append(el('p', { class: 'liste-vide' },
      el('strong', {}, 'Personne pour l’instant'),
      'Ajoutez la nounou ou la femme de ménage pour commencer à compter ses heures.'));
  }

  const moisCourant = aujourdhui().slice(0, 7);
  for (const p of etat.personnels) {
    const { minutes, cents } = totalDuMois(p.id, moisCourant);
    const taux = tauxCourant(p.id);
    hote.append(el('button', {
      class: 'carte-personne', type: 'button',
      onclick: () => ouvrirPersonne(p.id),
    },
    el('span', { class: 'nom' }, p.nom),
    el('span', { class: 'sous-ligne' },
      taux ? `${formaterMontant(taux.taux_cents)}/h` : 'taux à définir',
      ' · ',
      `${libelleMois(moisCourant)} : ${formaterDuree(minutes)}`,
      minutes ? ` · ${formaterMontant(cents)}` : ''),
    ));
  }

  hote.append(el('button', {
    class: 'btn btn-secondaire', onclick: ouvrirNouvellePersonne,
  }, '+ Nouvelle personne'));

  hote.append(el('p', { class: 'feuille-info' },
    'Ce décompte sert à suivre les heures à deux, pas à déclarer. Le montant '
    + 'réellement prélevé par Pajemploi ou le CESU diffère toujours un peu : '
    + 'notez-le en fin de mois dans la synthèse.'));
}

function ouvrirPersonne(id) {
  etat.personnelOuvert = id;
  etat.ongletPersonnel = 'calendrier';
  etat.lundiAffiche = lundiDe(aujourdhui());
  rendrePersonnel();
}

// ── Onglet Calendrier ──────────────────────────────────────────────────────

function rendreCalendrier(hote, personne) {
  const lundi = etat.lundiAffiche;
  const jours = joursDeLaSemaine(lundi);

  const allerA = (iso) => { etat.lundiAffiche = iso; rendrePersonnel(); };

  hote.append(el('div', { class: 'barre-semaine' },
    el('button', {
      class: 'fleche', type: 'button', 'aria-label': 'Semaine précédente',
      onclick: () => allerA(ajouterJours(lundi, -7)),
    }, '‹'),
    // Toucher le libellé ramène à la semaine en cours : après avoir remonté
    // six mois en arrière, c'est le geste qu'on cherche.
    el('button', {
      class: 'libelle-semaine', type: 'button',
      onclick: () => allerA(lundiDe(aujourdhui())),
    }, `semaine du ${fmtJourCourt.format(depuisIso(lundi))}`),
    el('button', {
      class: 'fleche', type: 'button', 'aria-label': 'Semaine suivante',
      onclick: () => allerA(ajouterJours(lundi, 7)),
    }, '›'),
  ));

  const boite = el('div', { class: 'jours' });
  for (const jour of jours) boite.append(ligneJour(personne, jour));
  hote.append(boite);

  hote.append(el('div', { class: 'actions-semaine' },
    el('button', {
      class: 'btn btn-secondaire', onclick: () => appliquerSemaineType(personne, jours),
    }, 'Semaine type'),
    el('button', {
      class: 'btn btn-secondaire', onclick: () => marquerNonTravaillee(personne, jours),
    }, 'Pas travaillé'),
    el('button', {
      class: 'btn btn-secondaire', onclick: () => reinitialiserSemaine(personne, jours),
    }, 'Réinitialiser'),
  ));

  // Les mois que la semaine touche. Une semaine à cheval en affiche deux : le
  // décompte se fait jour par jour, jamais semaine par semaine, sinon les mois
  // seraient faux deux fois par an.
  const mois = [...new Set(jours.map((j) => j.slice(0, 7)))];
  const totaux = el('div', { class: 'totaux-mois' });
  for (const m of mois) {
    const { minutes, cents } = totalDuMois(personne.id, m);
    totaux.append(el('div', { class: 'total-mois' },
      el('span', { class: 'mois' }, libelleMois(m)),
      el('span', { class: 'heures' }, formaterDuree(minutes)),
      el('span', { class: 'montant' }, formaterMontant(cents))));
  }
  hote.append(totaux);
}

function ligneJour(personne, jour) {
  const saisie = heureDuJour(personne.id, jour);
  const minutes = saisie ? saisie.minutes : null;

  const horaires = champsHoraires(saisie && saisie.debut, saisie && saisie.fin, () => {
    const lu = horaires.lire();
    // Un début sans fin : on attend la seconde moitié plutôt que d'enregistrer
    // une journée vide. Rien à signaler, le geste n'est pas terminé.
    if (lu === 'incomplet') return;
    if (lu === null) { effacerJour(personne, jour); return; }
    if (lu.minutes < 0) {
      toast('La fin doit venir après le début');
      rendrePersonnel();
      return;
    }
    enregistrerJour(personne, jour, lu);
  });

  const d = depuisIso(jour);
  // « 1er » et non « 1 » : c'est la seule irrégularité du quantième français.
  const quantieme = d.getDate() === 1 ? '1er' : String(d.getDate());

  // Une journée d'avant la saisie par horaires, ou posée par « Pas travaillé » :
  // elle compte dans les totaux mais n'a pas d'heures à montrer. On affiche sa
  // durée pour qu'elle ne disparaisse pas silencieusement de l'écran.
  const sansHoraires = minutes !== null && !(saisie && saisie.debut);
  const inhabituel = ecarteDuRythme(personne, jour, saisie);

  return el('div', {
    class: [
      'jour',
      jour === aujourdhui() ? 'aujourdhui' : '',
      minutes === null ? 'vide' : '',
      inhabituel ? 'inhabituel' : '',
    ].filter(Boolean).join(' '),
    title: inhabituel ? 'Différent de la semaine type' : null,
  },
  el('span', { class: 'jour-nom' }, `${JOURS[(d.getDay() || 7) - 1]} ${quantieme}`),
  horaires,
  el('span', { class: `jour-duree ${sansHoraires ? 'sans-horaires' : ''}` },
    formaterDuree(minutes)),
  );
}

// ── Écriture des heures ────────────────────────────────────────────────────

/** Copie profonde de l'état des heures, pour pouvoir revenir en arrière si la
 *  base refuse l'écriture. Une copie du tableau ne suffirait pas : on modifie
 *  les objets eux-mêmes. */
const memoriserHeures = () => etat.personnelsHeures.map((h) => ({ ...h }));

/** Range les lignes revenues de la base à la place des provisoires. */
function remplacerHeures(lignes) {
  for (const ligne of lignes) {
    const i = etat.personnelsHeures
      .findIndex((h) => h.personnel_id === ligne.personnel_id && h.jour === ligne.jour);
    if (i === -1) etat.personnelsHeures.push(ligne);
    else etat.personnelsHeures[i] = ligne;
  }
}

function poserLocalement(personneId, jour, { minutes, debut = null, fin = null }) {
  const existant = heureDuJour(personneId, jour);
  if (existant) { Object.assign(existant, { minutes, debut, fin }); return; }
  etat.personnelsHeures.push({
    id: `provisoire-${personneId}-${jour}`,
    espace_id: etat.espaceId, personnel_id: personneId, jour, minutes, debut, fin,
  });
}

async function enregistrerJour(personne, jour, valeurs) {
  await ecrireJours(personne, [{ jour, ...valeurs }]);
}

/**
 * Écrit une ou plusieurs journées d'un coup. L'écran est mis à jour avant la
 * réponse de la base : saisir sept jours de suite ne doit pas donner
 * l'impression de ramer.
 *
 * `minutes` part en base à côté des horaires bien qu'elle s'en déduise. C'est
 * une redondance assumée : les totaux restent une somme d'entiers, et une
 * journée sans horaires — « elle n'est pas venue » — garde un sens.
 */
async function ecrireJours(personne, saisies) {
  const memoire = memoriserHeures();
  for (const s of saisies) poserLocalement(personne.id, s.jour, s);
  rendrePersonnel();

  try {
    const lignes = await db.enregistrerHeures(saisies.map((s) => ({
      espace_id: etat.espaceId,
      personnel_id: personne.id,
      jour: s.jour,
      minutes: s.minutes,
      debut: s.debut || null,
      fin: s.fin || null,
    })));
    remplacerHeures(lignes);
    rendrePersonnel();
  } catch (e) {
    etat.personnelsHeures = memoire;
    rendrePersonnel();
    toast(`Impossible d’enregistrer : ${e.message}`);
  }
}

const effacerJour = (personne, jour) => effacerJours(personne, [jour]);

/** Rend une ou plusieurs journées à l'état « pas encore saisi ». À ne pas
 *  confondre avec « Pas travaillé », qui les pose à zéro. */
async function effacerJours(personne, jours) {
  const lignes = jours.map((j) => heureDuJour(personne.id, j)).filter(Boolean);
  if (!lignes.length) { rendrePersonnel(); return; }

  const memoire = memoriserHeures();
  // Une ligne encore provisoire n'existe pas en base : rien à y supprimer.
  const ids = lignes.map((l) => l.id).filter((id) => !String(id).startsWith('provisoire-'));
  etat.personnelsHeures = etat.personnelsHeures.filter((h) => !lignes.includes(h));
  rendrePersonnel();
  if (!ids.length) return;

  try {
    await db.supprimerHeures(ids);
  } catch (e) {
    etat.personnelsHeures = memoire;
    rendrePersonnel();
    toast(`Suppression impossible : ${e.message}`);
  }
}

/**
 * Vide la semaine affichée.
 *
 * Les journées redeviennent « pas encore saisies », et non « zéro heure » : le
 * bouton voisin « Pas travaillé » sert à cela, et confondre les deux ferait
 * passer une semaine effacée par mégarde pour une semaine vérifiée.
 */
async function reinitialiserSemaine(personne, jours) {
  const saisies = jours.filter((j) => heureDuJour(personne.id, j));
  if (!saisies.length) { toast('Cette semaine est déjà vide'); return; }

  const oui = await confirmer('Réinitialiser cette semaine ?', {
    detail: `${saisies.length} journée${saisies.length > 1 ? 's' : ''} `
      + `redevien${saisies.length > 1 ? 'nent' : 't'} vierge${saisies.length > 1 ? 's' : ''} : `
      + 'ni horaires, ni zéro. Le total du mois est recalculé.',
    texteOk: 'Réinitialiser', danger: true,
  });
  if (!oui) return;
  await effacerJours(personne, saisies);
}

/** La semaine type, sept entrées du lundi au dimanche : `null` pour un jour non
 *  travaillé, `{ debut, fin }` sinon. */
const semaineTypeDe = (personne) => {
  const brut = personne.semaine_type_horaires;
  return Array.isArray(brut) ? brut : [];
};

/** L'entrée de la semaine type qui correspond à une date. */
const typeDuJour = (personne, jour) =>
  semaineTypeDe(personne)[(depuisIso(jour).getDay() || 7) - 1] || null;

/**
 * La journée s'écarte-t-elle du rythme habituel ?
 *
 * Sert à signaler les jours inhabituels, qui sont aussi là où se logent les
 * fautes de frappe. On compare les horaires et non la seule durée : venir de
 * 9 h à 12 h au lieu de 8 h à 11 h fait le même temps, mais ce n'est pas la
 * même journée, et c'est exactement le genre d'erreur qu'on veut voir.
 *
 * Une journée pas encore saisie n'est pas un écart — c'est une case vide, elle
 * se repère autrement. Sans semaine type, il n'y a rien à comparer : on ne
 * surligne alors aucune ligne plutôt que de les surligner toutes.
 */
function ecarteDuRythme(personne, jour, saisie) {
  if (!saisie) return false;
  const modele = semaineTypeDe(personne);
  if (!modele.some(Boolean)) return false;

  const type = typeDuJour(personne, jour);
  // Jour normalement chômé : toute heure travaillée est un écart.
  if (!type || !type.debut || !type.fin) return saisie.minutes > 0;
  // Jour normalement travaillé, mais posé sans horaires (« Pas travaillé »).
  if (!saisie.debut || !saisie.fin) return true;
  return hhmm(saisie.debut) !== hhmm(type.debut) || hhmm(saisie.fin) !== hhmm(type.fin);
}

async function appliquerSemaineType(personne, jours) {
  const modele = semaineTypeDe(personne);
  if (!modele.some(Boolean)) {
    toast('Réglez d’abord la semaine type dans ⋯');
    return;
  }
  if (jours.some((j) => heureDuJour(personne.id, j))) {
    const oui = await confirmer('Remplacer cette semaine ?', {
      detail: 'Les horaires déjà saisis seront écrasés par la semaine type.',
      texteOk: 'Remplacer',
    });
    if (!oui) return;
  }

  await ecrireJours(personne, jours.map((jour, i) => {
    const type = modele[i];
    // Un jour non travaillé dans le modèle devient un zéro explicite, et non
    // une case vide : appliquer la semaine type vaut vérification.
    if (!type || !type.debut || !type.fin) return { jour, minutes: 0 };
    const minutes = minutesDeLHeure(type.fin) - minutesDeLHeure(type.debut);
    return { jour, minutes: Math.max(0, minutes), debut: type.debut, fin: type.fin };
  }));
}

async function marquerNonTravaillee(personne, jours) {
  if (jours.some((j) => (heureDuJour(personne.id, j) || {}).minutes)) {
    const oui = await confirmer('Mettre la semaine à zéro ?', {
      detail: 'Les horaires saisis cette semaine-là seront effacés et la semaine comptera 0,00 h.',
      texteOk: 'Mettre à zéro',
    });
    if (!oui) return;
  }
  await ecrireJours(personne, jours.map((jour) => ({ jour, minutes: 0 })));
}

// ── Onglet Synthèse ────────────────────────────────────────────────────────

function rendreSynthese(hote, personne) {
  const mois = moisConnus(personne.id);
  if (!mois.length) {
    hote.append(el('p', { class: 'liste-vide' },
      el('strong', {}, 'Rien à résumer'),
      'Saisissez des heures dans le calendrier : les mois apparaîtront ici.'));
  }
  for (const m of mois) hote.append(blocMois(personne, m));

  hote.append(el('p', { class: 'histo-titre' }, 'Taux horaire'));
  const periodes = tauxDe(personne.id).reverse();
  if (!periodes.length) {
    hote.append(el('p', { class: 'feuille-info' },
      'Aucun taux défini : les montants resteront à zéro. Ajoutez-en un dans ⋯.'));
  }
  for (const t of periodes) {
    hote.append(el('div', { class: 'ligne-taux' },
      el('span', { class: 'montant' }, `${formaterMontant(t.taux_cents)}/h`),
      el('span', { class: 'periode' }, t.fin
        ? `du ${dateAvecAnnee(t.debut)} au ${dateAvecAnnee(t.fin)}`
        : `depuis le ${dateAvecAnnee(t.debut)}`)));
  }
}

function blocMois(personne, mois) {
  const { minutes, cents } = totalDuMois(personne.id, mois);
  const paiement = paiementDe(personne.id, mois);

  const bloc = el('div', { class: 'bloc-mois' },
    el('p', { class: 'mois-titre' }, libelleMois(mois)),
    el('p', { class: 'mois-calcul' }, formaterDuree(minutes), ' · calculé ', formaterMontant(cents)),
  );

  if (!paiement) {
    bloc.append(el('button', {
      class: 'btn btn-fantome', type: 'button',
      onclick: () => ouvrirPaiement(personne, mois, cents, null),
    }, 'Noter le paiement'));
    return bloc;
  }

  const ecart = paiement.montant_paye_cents - cents;
  bloc.append(el('button', {
    class: 'mois-paiement', type: 'button',
    onclick: () => ouvrirPaiement(personne, mois, cents, paiement),
  },
  el('span', {}, `payé ${formaterMontant(paiement.montant_paye_cents)} le ${dateAvecAnnee(paiement.date_paiement)}`),
  ecart
    ? el('span', { class: `ecart ${ecart > 0 ? 'plus' : 'moins'}` },
      `${ecart > 0 ? '+' : '−'}${formaterMontant(Math.abs(ecart))}`)
    : null,
  ));

  // Le calcul a changé depuis le paiement : quelqu'un a corrigé des heures.
  // Le dire évite de chercher l'écart du mauvais côté.
  if (paiement.montant_calcule_cents !== cents) {
    bloc.append(el('p', { class: 'mois-note' },
      `Au moment du paiement, le calcul donnait ${formaterMontant(paiement.montant_calcule_cents)} `
      + '— des heures ont été modifiées depuis.'));
  }
  if (paiement.note) bloc.append(el('p', { class: 'mois-note' }, paiement.note));
  return bloc;
}

/** Saisie du montant réellement versé. `centsCalcules` sert de proposition et,
 *  pour un nouveau paiement, se fige dans la ligne : si quelqu'un corrige des
 *  heures six mois plus tard, l'écart doit rester imputable à l'URSSAF et non
 *  à la retouche. */
function ouvrirPaiement(personne, mois, centsCalcules, existant) {
  const enEuros = (cents) => (cents / 100).toFixed(2).replace('.', ',');

  const montant = el('input', {
    type: 'text', inputmode: 'decimal',
    value: enEuros(existant ? existant.montant_paye_cents : centsCalcules),
  });
  const date = el('input', {
    type: 'date', value: existant ? existant.date_paiement : aujourdhui(),
  });
  const note = el('input', {
    type: 'text', maxlength: 120, value: (existant && existant.note) || '',
    placeholder: 'régularisation congés…',
  });

  const enregistrer = async () => {
    const cents = enCentimes(montant.value);
    if (!Number.isFinite(cents)) { toast('Montant illisible'); montant.focus(); return; }
    if (!date.value) { toast('Donnez la date du paiement'); return; }
    try {
      const ligne = await db.enregistrerPaiement({
        espace_id: etat.espaceId,
        personnel_id: personne.id,
        mois: `${mois}-01`,
        montant_paye_cents: cents,
        montant_calcule_cents: existant ? existant.montant_calcule_cents : centsCalcules,
        date_paiement: date.value,
        note: note.value.trim() || null,
      });
      const i = etat.personnelsPaiements
        .findIndex((x) => x.personnel_id === personne.id && x.mois.slice(0, 7) === mois);
      if (i === -1) etat.personnelsPaiements.push(ligne);
      else etat.personnelsPaiements[i] = ligne;
      fermerFeuille();
      rendrePersonnel();
      toast('Paiement enregistré');
    } catch (e) {
      toast(`Enregistrement impossible : ${e.message}`);
    }
  };

  const supprimer = async () => {
    fermerFeuille();
    const oui = await confirmer('Supprimer ce paiement ?', {
      detail: 'Le mois redeviendra « non noté ». Les heures ne sont pas touchées.',
      texteOk: 'Supprimer', danger: true,
    });
    if (!oui) return;
    const memoire = etat.personnelsPaiements;
    etat.personnelsPaiements = etat.personnelsPaiements.filter((x) => x.id !== existant.id);
    rendrePersonnel();
    try {
      await db.supprimerPaiement(existant.id);
    } catch (e) {
      etat.personnelsPaiements = memoire;
      rendrePersonnel();
      toast(`Suppression impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, `${libelleMois(mois)} — ${personne.nom}`),
    el('p', { class: 'feuille-info' },
      `Le calcul donne ${formaterMontant(centsCalcules)}. Notez ici ce que Pajemploi `
      + 'ou le CESU a réellement prélevé : c’est l’écart entre les deux qui sera '
      + 'utile le jour où il faudra comprendre un mois.'),
    el('label', { class: 'champ' }, el('span', {}, 'Montant réellement payé'), montant),
    el('label', { class: 'champ' }, el('span', {}, 'Date du paiement'), date),
    el('label', { class: 'champ' }, el('span', {}, 'Note (facultative)'), note),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, 'Enregistrer'),
    existant
      ? el('button', { class: 'btn btn-destructif', onclick: supprimer }, 'Supprimer ce paiement')
      : null,
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

// ══════════════════ Onglet Export ══════════════════
//
// Le relevé part à la personne concernée, par WhatsApp ou autrement. Il ne
// contient donc que des heures : le montant que l'app calcule n'est pas celui
// que Pajemploi versera, et envoyer un chiffre qui ne correspondra pas au
// virement créerait une conversation pénible pour rien.
//
// L'image se fabrique sur un `<canvas>`, sans bibliothèque ni serveur — l'app
// n'a pas d'étape de build et doit marcher hors ligne.

const LARGEUR_RELEVE = 760;
const ECHELLE_RELEVE = 2;          // pour que le texte reste net une fois zoomé

/** Couleurs figées en clair, et non reprises des variables de la charte : le
 *  relevé est un document qui sort du foyer, il ne doit pas basculer en thème
 *  sombre selon le réglage du téléphone qui l'a produit. */
const ENCRE = '#1B1917';
const ENCRE_PALE = '#7A736C';
const TRAIT = '#E3DDD4';
const ROUGE = '#D8232A';

/** Les journées d'un mois réellement travaillées, dans l'ordre. Les jours à
 *  zéro et les jours non saisis n'ont rien à faire dans un relevé : on y lit
 *  ce qui a été fait, pas ce qui ne l'a pas été. */
const journeesDuMois = (personnelId, mois) => etat.personnelsHeures
  .filter((h) => h.personnel_id === personnelId && h.jour.startsWith(mois) && h.minutes > 0)
  .sort((a, b) => a.jour.localeCompare(b.jour));

async function dessinerReleve(personne, mois) {
  const journees = journeesDuMois(personne.id, mois);
  const { minutes } = totalDuMois(personne.id, mois);

  const marge = 48;
  const hauteurLigne = 46;
  const hauteurEntete = 188;
  const hauteurPied = 150;
  const hauteur = hauteurEntete + journees.length * hauteurLigne + hauteurPied;

  const canvas = el('canvas', {
    width: LARGEUR_RELEVE * ECHELLE_RELEVE, height: hauteur * ECHELLE_RELEVE,
  });
  const c = canvas.getContext('2d');
  c.scale(ECHELLE_RELEVE, ECHELLE_RELEVE);

  // Les polices de la charte ne sont utilisables dans un canvas qu'une fois
  // chargées : sans cette attente, le relevé sortirait en police système.
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const police = (taille, graisse = 400) =>
    `${graisse} ${taille}px 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif`;

  c.fillStyle = '#FFFFFF';
  c.fillRect(0, 0, LARGEUR_RELEVE, hauteur);

  c.fillStyle = ENCRE;
  c.font = police(34, 700);
  c.fillText(personne.nom, marge, 72);

  c.fillStyle = ENCRE_PALE;
  c.font = police(22, 500);
  c.fillText(libelleMois(mois), marge, 108);

  c.fillStyle = ROUGE;
  c.fillRect(marge, 132, 64, 4);

  // Colonnes : jour, début, fin, durée — la durée calée à droite.
  const colJour = marge;
  const colDebut = marge + 230;
  const colFin = marge + 360;
  const colDuree = LARGEUR_RELEVE - marge;

  c.fillStyle = ENCRE_PALE;
  c.font = police(15, 700);
  const entete = 172;
  c.fillText('JOUR', colJour, entete);
  c.fillText('DÉBUT', colDebut, entete);
  c.fillText('FIN', colFin, entete);
  c.textAlign = 'right';
  c.fillText('HEURES', colDuree, entete);
  c.textAlign = 'left';

  let y = hauteurEntete + 14;
  for (const h of journees) {
    c.strokeStyle = TRAIT;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(marge, y - 26);
    c.lineTo(LARGEUR_RELEVE - marge, y - 26);
    c.stroke();

    const d = depuisIso(h.jour);
    const quantieme = d.getDate() === 1 ? '1er' : String(d.getDate());
    c.fillStyle = ENCRE;
    c.font = police(20, 500);
    c.fillText(`${JOURS[(d.getDay() || 7) - 1]} ${quantieme}`, colJour, y);
    c.font = police(20);
    c.fillText(hhmm(h.debut) || '—', colDebut, y);
    c.fillText(hhmm(h.fin) || '—', colFin, y);
    c.textAlign = 'right';
    c.font = police(20, 600);
    c.fillText(formaterDuree(h.minutes), colDuree, y);
    c.textAlign = 'left';
    y += hauteurLigne;
  }

  const yTotal = y + 8;
  c.strokeStyle = ENCRE;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(marge, yTotal - 30);
  c.lineTo(LARGEUR_RELEVE - marge, yTotal - 30);
  c.stroke();

  c.fillStyle = ENCRE;
  c.font = police(22, 700);
  c.fillText(`Total — ${journees.length} jour${journees.length > 1 ? 's' : ''}`, colJour, yTotal + 10);
  c.textAlign = 'right';
  c.font = police(26, 700);
  c.fillText(formaterDuree(minutes), colDuree, yTotal + 12);
  c.textAlign = 'left';

  c.fillStyle = ENCRE_PALE;
  c.font = police(15);
  c.fillText(`Relevé établi le ${dateAvecAnnee(aujourdhui())}`, colJour, yTotal + 62);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  // Un nom de fichier sans accent ni espace : il traverse WhatsApp, iOS et
  // Android sans se faire réécrire en chemin.
  const nom = `${personne.nom} ${libelleMois(mois)}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { canvas, blob, fichier: new File([blob], `${nom}.png`, { type: 'image/png' }) };
}

/**
 * Envoie le relevé.
 *
 * Le partage natif d'abord : sur iPhone, il ouvre la feuille où WhatsApp
 * figure déjà, et la photo part en un geste. Un téléchargement classique y
 * déposerait le fichier dans « Fichiers », qu'il faudrait ensuite aller
 * rouvrir — quatre gestes au lieu d'un.
 *
 * Le fichier est fabriqué à l'avance, à l'affichage de l'aperçu : `share()`
 * exige d'être appelé dans le geste de l'utilisateur, et Safari refuse si une
 * attente s'est glissée entre le toucher et l'appel.
 */
async function envoyerReleve(fichier, personne, mois) {
  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try {
      await navigator.share({
        files: [fichier],
        title: `${personne.nom} — ${libelleMois(mois)}`,
      });
    } catch (e) {
      if (e.name !== 'AbortError') toast('Partage impossible');
    }
    return;
  }

  // Ordinateur, ou navigateur sans partage de fichiers : téléchargement.
  const url = URL.createObjectURL(fichier);
  const lien = el('a', { href: url, download: fichier.name });
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Relevé téléchargé');
}

function rendreExport(hote, personne) {
  const mois = moisConnus(personne.id);
  if (!mois.length) {
    hote.append(el('p', { class: 'liste-vide' },
      el('strong', {}, 'Rien à exporter'),
      'Saisissez des heures dans le calendrier, les mois apparaîtront ici.'));
    return;
  }

  if (!mois.includes(etat.moisExport)) [etat.moisExport] = mois;

  const choix = el('select', { class: 'choix-mois', 'aria-label': 'Mois à exporter' });
  for (const m of mois) choix.append(el('option', { value: m }, libelleMois(m)));
  choix.value = etat.moisExport;

  const apercu = el('div', { class: 'apercu-releve' });
  const bouton = el('button', { class: 'btn btn-primaire', disabled: true }, 'Préparation…');

  const preparer = async () => {
    bouton.disabled = true;
    bouton.textContent = 'Préparation…';
    vider(apercu);
    try {
      const { canvas, fichier } = await dessinerReleve(personne, etat.moisExport);
      canvas.className = 'releve';
      apercu.append(canvas);
      bouton.disabled = false;
      bouton.textContent = navigator.canShare && navigator.canShare({ files: [fichier] })
        ? 'Envoyer le relevé'
        : 'Télécharger le relevé';
      bouton.onclick = () => envoyerReleve(fichier, personne, etat.moisExport);
    } catch (e) {
      bouton.textContent = 'Image impossible à produire';
      toast(`Export impossible : ${e.message}`);
    }
  };

  choix.addEventListener('change', () => { etat.moisExport = choix.value; preparer(); });

  hote.append(
    el('label', { class: 'champ' }, el('span', {}, 'Mois à envoyer'), choix),
    el('p', { class: 'feuille-info' },
      'Le relevé ne contient que les heures, jamais de montant : ce que l’app '
      + 'calcule n’est pas ce que Pajemploi versera, et l’écart se discuterait mal.'),
    apercu,
    bouton,
  );

  preparer();
}

// ── Créer et régler une personne ───────────────────────────────────────────

/**
 * Les sept lignes de la semaine type, en heures de début et de fin.
 *
 * `lire()` rend un tableau de sept entrées, du lundi au dimanche : `null` pour
 * un jour non travaillé, `{ debut, fin }` sinon. `valide()` signale une ligne
 * à moitié remplie ou une fin antérieure au début.
 */
function champsSemaineType(valeurs) {
  const boite = el('div', { class: 'jours' });
  const lignes = [];

  for (let i = 0; i < 7; i += 1) {
    const type = (valeurs && valeurs[i]) || null;
    const duree = el('span', { class: 'jour-duree' });

    const horaires = champsHoraires(type && type.debut, type && type.fin, () => {
      const lu = horaires.lire();
      duree.textContent = lu && lu !== 'incomplet' && lu.minutes >= 0
        ? formaterDuree(lu.minutes)
        : '';
    });

    const lu = horaires.lire();
    duree.textContent = lu && lu !== 'incomplet' && lu.minutes >= 0
      ? formaterDuree(lu.minutes) : '';

    lignes.push(horaires);
    boite.append(el('div', { class: 'jour' },
      el('span', { class: 'jour-nom' }, JOURS[i]),
      horaires,
      duree));
  }

  boite.lire = () => lignes.map((h) => {
    const lu = h.lire();
    if (!lu || lu === 'incomplet' || lu.minutes < 0) return null;
    return { debut: lu.debut, fin: lu.fin };
  });

  boite.valide = () => lignes.every((h) => {
    const lu = h.lire();
    return lu === null || (lu !== 'incomplet' && lu.minutes >= 0);
  });

  return boite;
}

/** Le 1er du mois en cours : la date d'effet la plus probable pour un taux. */
const premierDuMois = () => `${aujourdhui().slice(0, 8)}01`;

function ouvrirNouvellePersonne() {
  const nom = el('input', { type: 'text', placeholder: 'Nounou Lucie', maxlength: 40 });
  const taux = el('input', { type: 'text', inputmode: 'decimal', placeholder: '16,00' });
  const debut = el('input', { type: 'date', value: premierDuMois() });
  const semaine = champsSemaineType([]);

  const creer = async () => {
    const valeurNom = nom.value.trim();
    if (!valeurNom) { toast('Donnez un nom'); nom.focus(); return; }
    const cents = enCentimes(taux.value);
    if (!Number.isFinite(cents) || cents <= 0) { toast('Taux horaire illisible'); taux.focus(); return; }
    if (!debut.value) { toast('Donnez la date d’effet du taux'); return; }
    if (!semaine.valide()) {
      toast('Semaine type : chaque jour veut un début et une fin, dans cet ordre');
      return;
    }

    try {
      const personne = await db.creerPersonnel({
        espace_id: etat.espaceId, nom: valeurNom,
        semaine_type_horaires: semaine.lire(),
      });
      etat.personnels.push(personne);
      const periode = await db.creerTaux({
        espace_id: etat.espaceId, personnel_id: personne.id,
        taux_cents: cents, debut: debut.value,
      });
      etat.personnelsTaux.push(periode);
      fermerFeuille();
      ouvrirPersonne(personne.id);
      toast('Personne créée');
    } catch (e) {
      toast(`Création impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Nouvelle personne'),
    el('label', { class: 'champ' }, el('span', {}, 'Nom'), nom),
    el('div', { class: 'separateur' }),
    el('label', { class: 'champ' }, el('span', {}, 'Taux horaire net'), taux),
    el('label', { class: 'champ' }, el('span', {}, 'À partir du'), debut),
    el('p', { class: 'feuille-info' },
      'Le jour d’une augmentation, vous ajouterez un nouveau taux : les mois '
      + 'déjà passés garderont celui qui s’appliquait à l’époque.'),
    el('div', { class: 'separateur' }),
    el('h3', { class: 'feuille-titre' }, 'Semaine type'),
    el('p', { class: 'feuille-info' },
      'Les heures habituelles, pour remplir une semaine d’un bouton. Modifiable '
      + 'à tout moment, et sans effet sur les semaines déjà saisies.'),
    semaine,
    el('button', { class: 'btn btn-primaire', onclick: creer }, 'Créer'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
  setTimeout(() => nom.focus(), 120);
}

function ouvrirReglagesPersonne(personne) {
  ouvrirFeuille(el('div', {},
    el('h2', {}, personne.nom),
    el('button', { class: 'btn btn-secondaire', onclick: () => ouvrirRenommer(personne) },
      'Renommer'),
    el('button', { class: 'btn btn-secondaire', onclick: () => ouvrirSemaineType(personne) },
      'Modifier la semaine type'),
    el('button', { class: 'btn btn-secondaire', onclick: () => ouvrirNouveauTaux(personne) },
      'Nouveau taux horaire'),
    el('div', { class: 'separateur' }),
    el('button', { class: 'btn btn-destructif', onclick: () => supprimerPersonne(personne) },
      'Supprimer cette personne'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

function ouvrirRenommer(personne) {
  const nom = el('input', { type: 'text', value: personne.nom, maxlength: 40 });

  const enregistrer = async () => {
    const valeur = nom.value.trim();
    if (!valeur) { toast('Donnez un nom'); return; }
    try {
      const maj = await db.majPersonnel(personne.id, { nom: valeur });
      remplacerPersonne(maj);
      fermerFeuille();
      rendrePersonnel();
      toast('Nom modifié');
    } catch (e) {
      toast(`Enregistrement impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Renommer'),
    el('label', { class: 'champ' }, el('span', {}, 'Nom'), nom),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, 'Enregistrer'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

function ouvrirSemaineType(personne) {
  const semaine = champsSemaineType(semaineTypeDe(personne));

  const enregistrer = async () => {
    if (!semaine.valide()) {
      toast('Chaque jour veut un début et une fin, dans cet ordre');
      return;
    }
    try {
      const maj = await db.majPersonnel(personne.id,
        { semaine_type_horaires: semaine.lire() });
      remplacerPersonne(maj);
      fermerFeuille();
      rendrePersonnel();
      toast('Semaine type enregistrée');
    } catch (e) {
      toast(`Enregistrement impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Semaine type'),
    el('p', { class: 'feuille-info' },
      'Ce modèle sert au bouton « Semaine type » du calendrier. Le changer ne '
      + 'touche à aucune semaine déjà saisie.'),
    semaine,
    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, 'Enregistrer'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

/**
 * Ajoute une période de taux et referme la précédente la veille.
 *
 * On n'écrase jamais le taux en cours : les jours déjà travaillés doivent
 * rester valorisés au prix de l'époque, et la suite des périodes est au
 * passage l'historique des augmentations.
 */
function ouvrirNouveauTaux(personne) {
  const montant = el('input', { type: 'text', inputmode: 'decimal', placeholder: '16,00' });
  const debut = el('input', { type: 'date', value: premierDuMois() });
  const courant = tauxCourant(personne.id);

  const enregistrer = async () => {
    const cents = enCentimes(montant.value);
    if (!Number.isFinite(cents) || cents <= 0) { toast('Montant illisible'); montant.focus(); return; }
    if (!debut.value) { toast('Donnez la date d’effet'); return; }
    if (courant && debut.value <= courant.debut) {
      toast(`La date doit être postérieure au ${dateAvecAnnee(courant.debut)}`);
      return;
    }

    try {
      if (courant) {
        const ferme = await db.majTaux(courant.id, { fin: ajouterJours(debut.value, -1) });
        const i = etat.personnelsTaux.findIndex((t) => t.id === courant.id);
        if (i !== -1) etat.personnelsTaux[i] = ferme;
      }
      const periode = await db.creerTaux({
        espace_id: etat.espaceId, personnel_id: personne.id,
        taux_cents: cents, debut: debut.value,
      });
      etat.personnelsTaux.push(periode);
      fermerFeuille();
      rendrePersonnel();
      toast('Nouveau taux enregistré');
    } catch (e) {
      toast(`Enregistrement impossible : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Nouveau taux horaire'),
    courant
      ? el('p', { class: 'feuille-info' },
        `Taux actuel : ${formaterMontant(courant.taux_cents)}/h depuis le `
        + `${dateAvecAnnee(courant.debut)}. Il se refermera la veille de la date ci-dessous, `
        + 'et les mois déjà passés garderont leur montant.')
      : null,
    el('label', { class: 'champ' }, el('span', {}, 'Nouveau taux net'), montant),
    el('label', { class: 'champ' }, el('span', {}, 'À partir du'), debut),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, 'Enregistrer'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

function remplacerPersonne(maj) {
  const i = etat.personnels.findIndex((p) => p.id === maj.id);
  if (i !== -1) etat.personnels[i] = maj;
}

async function supprimerPersonne(personne) {
  fermerFeuille();
  const oui = await confirmer(`Supprimer ${personne.nom} ?`, {
    detail: 'Toutes ses heures, ses taux et ses paiements sont effacés définitivement.',
    texteOk: 'Supprimer', danger: true,
  });
  if (!oui) return;

  const memoire = {
    personnels: etat.personnels,
    taux: etat.personnelsTaux,
    heures: etat.personnelsHeures,
    paiements: etat.personnelsPaiements,
  };
  etat.personnels = etat.personnels.filter((p) => p.id !== personne.id);
  etat.personnelsTaux = etat.personnelsTaux.filter((t) => t.personnel_id !== personne.id);
  etat.personnelsHeures = etat.personnelsHeures.filter((h) => h.personnel_id !== personne.id);
  etat.personnelsPaiements = etat.personnelsPaiements.filter((x) => x.personnel_id !== personne.id);
  etat.personnelOuvert = null;
  rendrePersonnel();

  try {
    // Les trois autres tables partent avec, par cascade déclarée dans le schéma.
    await db.supprimerPersonnel(personne.id);
    toast('Personne supprimée');
  } catch (e) {
    etat.personnels = memoire.personnels;
    etat.personnelsTaux = memoire.taux;
    etat.personnelsHeures = memoire.heures;
    etat.personnelsPaiements = memoire.paiements;
    rendrePersonnel();
    toast(`Suppression impossible : ${e.message}`);
  }
}
