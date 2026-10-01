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
const HEURES_MAX = 12;

// Le pas de 5 minutes, et non le quart d'heure : une journée qui se termine à
// 15 h 50 donne une durée que le quart d'heure ne sait pas écrire, et arrondir
// fausserait le décompte tous les mois dans le même sens.
const PAS_MINUTES = 5;

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

/** `null` n'est pas zéro : il veut dire « pas encore saisi », quand 0 h 00 veut
 *  dire « vérifié, elle n'est pas venue ». Toute l'utilité d'un calendrier de
 *  comptage tient dans cette différence. */
const formaterDuree = (minutes) => (minutes === null || minutes === undefined
  ? '—'
  : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`);

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
  for (const [cle, libelle] of [['calendrier', 'Calendrier'], ['synthese', 'Synthèse']]) {
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

  const selH = el('select', { class: 'sel-h', 'aria-label': `Heures du ${jour}` });
  selH.append(el('option', { value: '' }, '—'));
  for (let h = 0; h <= HEURES_MAX; h += 1) {
    selH.append(el('option', { value: String(h) }, String(h)));
  }

  const selM = el('select', { class: 'sel-m', 'aria-label': `Minutes du ${jour}` });
  for (let m = 0; m < 60; m += PAS_MINUTES) {
    selM.append(el('option', { value: String(m) }, String(m).padStart(2, '0')));
  }
  // Une valeur héritée hors du pas de 5 doit rester lisible, plutôt que de
  // faire apparaître un menu vide et de se perdre au premier enregistrement.
  if (minutes !== null && minutes % PAS_MINUTES) {
    const reste = minutes % 60;
    selM.append(el('option', { value: String(reste) }, String(reste).padStart(2, '0')));
  }

  selH.value = minutes === null ? '' : String(Math.min(HEURES_MAX, Math.floor(minutes / 60)));
  selM.value = minutes === null ? '0' : String(minutes % 60);
  selM.disabled = minutes === null;

  const ecrire = () => {
    if (selH.value === '') { effacerJour(personne, jour); return; }
    enregistrerJour(personne, jour, Number(selH.value) * 60 + Number(selM.value));
  };
  selH.addEventListener('change', ecrire);
  selM.addEventListener('change', ecrire);

  const d = depuisIso(jour);
  // « 1er » et non « 1 » : c'est la seule irrégularité du quantième français.
  const quantieme = d.getDate() === 1 ? '1er' : String(d.getDate());
  return el('div', {
    class: `jour ${jour === aujourdhui() ? 'aujourdhui' : ''} ${minutes === null ? 'vide' : ''}`,
  },
  el('span', { class: 'jour-nom' }, `${JOURS[(d.getDay() || 7) - 1]} ${quantieme}`),
  el('span', { class: 'jour-saisie' }, selH, el('span', { class: 'sep' }, 'h'), selM),
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

function poserLocalement(personneId, jour, minutes) {
  const existant = heureDuJour(personneId, jour);
  if (existant) { existant.minutes = minutes; return; }
  etat.personnelsHeures.push({
    id: `provisoire-${personneId}-${jour}`,
    espace_id: etat.espaceId, personnel_id: personneId, jour, minutes,
  });
}

async function enregistrerJour(personne, jour, minutes) {
  await ecrireJours(personne, [{ jour, minutes }]);
}

/** Écrit une ou plusieurs journées d'un coup. L'écran est mis à jour avant la
 *  réponse de la base : saisir sept jours de suite ne doit pas donner
 *  l'impression de ramer. */
async function ecrireJours(personne, saisies) {
  const memoire = memoriserHeures();
  for (const { jour, minutes } of saisies) poserLocalement(personne.id, jour, minutes);
  rendrePersonnel();

  try {
    const lignes = await db.enregistrerHeures(saisies.map(({ jour, minutes }) => ({
      espace_id: etat.espaceId, personnel_id: personne.id, jour, minutes,
    })));
    remplacerHeures(lignes);
    rendrePersonnel();
  } catch (e) {
    etat.personnelsHeures = memoire;
    rendrePersonnel();
    toast(`Impossible d’enregistrer : ${e.message}`);
  }
}

async function effacerJour(personne, jour) {
  const existant = heureDuJour(personne.id, jour);
  if (!existant) { rendrePersonnel(); return; }

  const memoire = memoriserHeures();
  const { id } = existant;
  etat.personnelsHeures = etat.personnelsHeures.filter((h) => h !== existant);
  rendrePersonnel();

  // Une ligne encore provisoire n'existe pas en base : rien à y supprimer.
  if (String(id).startsWith('provisoire-')) return;

  try {
    await db.supprimerHeures([id]);
  } catch (e) {
    etat.personnelsHeures = memoire;
    rendrePersonnel();
    toast(`Suppression impossible : ${e.message}`);
  }
}

async function appliquerSemaineType(personne, jours) {
  const modele = personne.semaine_type || [];
  if (!modele.some((m) => m > 0)) {
    toast('Réglez d’abord la semaine type dans ⋯');
    return;
  }
  if (jours.some((j) => heureDuJour(personne.id, j))) {
    const oui = await confirmer('Remplacer cette semaine ?', {
      detail: 'Les heures déjà saisies seront écrasées par la semaine type.',
      texteOk: 'Remplacer',
    });
    if (!oui) return;
  }
  await ecrireJours(personne, jours.map((jour, i) => ({ jour, minutes: modele[i] || 0 })));
}

async function marquerNonTravaillee(personne, jours) {
  if (jours.some((j) => (heureDuJour(personne.id, j) || {}).minutes)) {
    const oui = await confirmer('Mettre la semaine à zéro ?', {
      detail: 'Les heures saisies cette semaine-là seront remplacées par 0 h 00.',
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

// ── Créer et régler une personne ───────────────────────────────────────────

/** Les sept menus de la semaine type. L'élément renvoyé porte `lire()`, qui
 *  rend les durées en minutes, du lundi au dimanche. */
function champsSemaineType(valeurs) {
  const boite = el('div', { class: 'jours' });
  const menus = [];

  for (let i = 0; i < 7; i += 1) {
    const minutes = valeurs[i] || 0;
    const selH = el('select', { class: 'sel-h', 'aria-label': `Heures du ${JOURS[i]}` });
    for (let h = 0; h <= HEURES_MAX; h += 1) {
      selH.append(el('option', { value: String(h) }, String(h)));
    }
    const selM = el('select', { class: 'sel-m', 'aria-label': `Minutes du ${JOURS[i]}` });
    for (let m = 0; m < 60; m += PAS_MINUTES) {
      selM.append(el('option', { value: String(m) }, String(m).padStart(2, '0')));
    }
    if (minutes % PAS_MINUTES) {
      const reste = minutes % 60;
      selM.append(el('option', { value: String(reste) }, String(reste).padStart(2, '0')));
    }
    selH.value = String(Math.min(HEURES_MAX, Math.floor(minutes / 60)));
    selM.value = String(minutes % 60);
    menus.push([selH, selM]);

    boite.append(el('div', { class: 'jour' },
      el('span', { class: 'jour-nom' }, JOURS[i]),
      el('span', { class: 'jour-saisie' }, selH, el('span', { class: 'sep' }, 'h'), selM)));
  }

  boite.lire = () => menus.map(([h, m]) => Number(h.value) * 60 + Number(m.value));
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

    try {
      const personne = await db.creerPersonnel({
        espace_id: etat.espaceId, nom: valeurNom, semaine_type: semaine.lire(),
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
  const semaine = champsSemaineType(personne.semaine_type || []);

  const enregistrer = async () => {
    try {
      const maj = await db.majPersonnel(personne.id, { semaine_type: semaine.lire() });
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
