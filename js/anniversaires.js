// Module « Anniversaires » : recenser les dates des amis et de la famille,
// et ne plus en rater aucun.

import {
  $, el, vider, toast, ouvrirFeuille, fermerFeuille, confirmer, groupeOptions,
} from './ui.js';
import { etat, pseudoDe } from './etat.js';
import * as db from './db.js';

export const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Fenêtre de la vue « À venir ». Deux mois : c'est le délai que Damien s'est
 *  donné pour avoir le temps de trouver un cadeau. */
const JOURS_A_VENIR = 60;

// ══════════════════ Dates ══════════════════

function aujourdhuiMinuit() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Le jour de l'année où l'on fête cet anniversaire. Un 29 février tombe le
 *  28 les années non bissextiles : on préfère fêter la veille plutôt que de
 *  laisser passer la date, ce qui est tout l'objet de ce module. */
function dateDansAnnee(annee, mois, jour) {
  const dernierDuMois = new Date(annee, mois, 0).getDate();
  return new Date(annee, mois - 1, Math.min(jour, dernierDuMois));
}

/** Prochaine occurrence, aujourd'hui compris. */
export function prochaineOccurrence(mois, jour) {
  const today = aujourdhuiMinuit();
  const cetteAnnee = dateDansAnnee(today.getFullYear(), mois, jour);
  return cetteAnnee >= today ? cetteAnnee : dateDansAnnee(today.getFullYear() + 1, mois, jour);
}

export const joursAvant = (mois, jour) =>
  Math.round((prochaineOccurrence(mois, jour) - aujourdhuiMinuit()) / 86400000);

/** Âge atteint à la prochaine occurrence, ou null si l'année est inconnue. */
export function ageAVenir(mois, jour, annee) {
  if (!annee) return null;
  return prochaineOccurrence(mois, jour).getFullYear() - annee;
}

function formaterDelai(jours) {
  if (jours === 0) return 'aujourd’hui';
  if (jours === 1) return 'demain';
  return `dans ${jours} jours`;
}

// ══════════════════ La liste ══════════════════

/** Les anniversaires saisis, plus ceux des deux membres — ils sont déjà en
 *  base depuis la section « Nos dates » des réglages, les ressaisir ici
 *  créerait deux vérités pour une même date. */
function tousLesAnniversaires() {
  const saisis = etat.anniversaires.map((a) => ({ ...a, membre: false }));

  const desMembres = etat.membres
    .filter((m) => m.date_naissance)
    .map((m) => {
      const [annee, mois, jour] = m.date_naissance.split('-').map(Number);
      return {
        id: `membre-${m.id}`,
        nom: m.pseudo,
        jour, mois, annee,
        prevoir_cadeau: false,
        note: '',
        membre: true,
      };
    });

  return [...saisis, ...desMembres];
}

export function rendreAnniversaires() {
  const hote = vider($('#contenu-anniversaires'));
  const tous = tousLesAnniversaires();

  if (etat.vueAnniversaires === 'a_venir') {
    const prochains = tous
      .map((a) => ({ ...a, jours: joursAvant(a.mois, a.jour) }))
      .filter((a) => a.jours <= JOURS_A_VENIR)
      .sort((x, y) => x.jours - y.jours);

    if (!prochains.length) {
      hote.append(vide(`Aucun anniversaire dans les ${JOURS_A_VENIR} prochains jours.`));
      return;
    }
    for (const a of prochains) hote.append(ligne(a, 'a_venir'));
    return;
  }

  const mois = etat.vueAnniversaires;
  const duMois = tous.filter((a) => a.mois === mois).sort((x, y) => x.jour - y.jour);

  if (!duMois.length) {
    hote.append(vide(`Aucun anniversaire en ${MOIS[mois - 1]}.`));
    return;
  }
  for (const a of duMois) hote.append(ligne(a, 'mois'));
}

function vide(message) {
  return el('div', { class: 'anniv-vide' },
    el('p', {}, message),
    el('p', { class: 'feuille-info' }, 'Ajoutez-en un avec le bouton +.'));
}

function ligne(a, vue) {
  const age = ageAVenir(a.mois, a.jour, a.annee);
  const jours = a.jours ?? joursAvant(a.mois, a.jour);

  const meta = [];
  if (age !== null) meta.push(`aura ${age} ans`);
  if (vue === 'a_venir') meta.push(formaterDelai(jours));
  else if (jours <= JOURS_A_VENIR) meta.push(formaterDelai(jours));

  const classes = ['anniv'];
  if (jours === 0) classes.push('anniv-aujourdhui');
  if (a.membre) classes.push('anniv-membre');

  return el('button', {
    class: classes.join(' '),
    onclick: () => (a.membre ? expliquerMembre(a) : ouvrirFiche(a)),
  },
    el('div', { class: 'anniv-date' },
      el('span', { class: 'anniv-jour' }, String(a.jour)),
      el('span', { class: 'anniv-mois' }, MOIS_COURTS[a.mois - 1])),
    el('div', { class: 'anniv-corps' },
      el('p', { class: 'anniv-nom' }, a.nom,
        a.prevoir_cadeau ? el('span', { class: 'anniv-cadeau' }, '🎁') : null),
      meta.length ? el('p', { class: 'anniv-meta' }, meta.join(' · ')) : null,
      a.note ? el('p', { class: 'anniv-note' }, a.note) : null),
  );
}

function expliquerMembre(a) {
  toast(a.nom === pseudoDe(etat.membreId)
    ? 'Ta date de naissance se modifie dans ⚙ Réglages'
    : `${a.nom} modifie sa date depuis son propre téléphone`);
}

// ══════════════════ Saisie ══════════════════

export function ouvrirNouvelAnniversaire() {
  ouvrirFiche(null);
}

function ouvrirFiche(existant) {
  const estNouveau = !existant;
  const a = existant || {};
  const maintenant = new Date();

  const champNom = el('input', {
    type: 'text', value: a.nom || '', maxlength: 40, placeholder: 'Léa, Papa, Tom & Julie…',
  });

  const champJour = el('select', {},
    ...Array.from({ length: 31 }, (_, i) => el('option', {
      value: String(i + 1), selected: (a.jour || maintenant.getDate()) === i + 1,
    }, String(i + 1))));

  const moisInitial = a.mois || maintenant.getMonth() + 1;
  const champMois = el('select', {},
    ...MOIS.map((nom, i) => el('option', {
      value: String(i + 1), selected: moisInitial === i + 1,
    }, nom)));

  const champAnnee = el('input', {
    type: 'text', inputmode: 'numeric', maxlength: 4,
    value: a.annee ? String(a.annee) : '', placeholder: 'facultatif',
  });

  const cadeau = groupeOptions(
    [{ cle: 'non', libelle: 'Non' }, { cle: 'oui', libelle: 'Oui' }],
    a.prevoir_cadeau ? 'oui' : 'non', { vert: true });

  const champNote = el('textarea', {
    rows: 3, maxlength: 300, value: a.note || '',
    placeholder: 'Idées de cadeau, ce qui lui ferait plaisir…',
  });

  const enregistrer = async (e) => {
    const nom = champNom.value.trim();
    const jour = Number(champJour.value);
    const mois = Number(champMois.value);
    const anneeSaisie = champAnnee.value.trim();

    if (!nom) { toast('Il manque le prénom'); return; }
    // Même contrôle que la contrainte de la base : jour et mois sont chacun
    // valides, mais leur combinaison ne l'est pas toujours.
    if (jour > new Date(2024, mois, 0).getDate()) {
      toast(`Le ${jour} ${MOIS[mois - 1]} n’existe pas`);
      return;
    }
    let annee = null;
    if (anneeSaisie) {
      annee = Number(anneeSaisie);
      if (!Number.isInteger(annee) || annee < 1900 || annee > maintenant.getFullYear()) {
        toast('Année invalide');
        return;
      }
    }

    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';
    const ligneBase = {
      nom, jour, mois, annee,
      prevoir_cadeau: cadeau.valeur === 'oui',
      note: champNote.value.trim() || null,
    };
    try {
      if (estNouveau) {
        await db.creerAnniversaire({
          ...ligneBase, espace_id: etat.espaceId, cree_par: etat.membreId,
        });
      } else {
        await db.majAnniversaire(a.id, ligneBase);
      }
      fermerFeuille();
      // On se place sur le mois saisi : sans ça, ajouter un anniversaire de
      // novembre depuis la vue « À venir » donne l'impression qu'il a disparu.
      etat.vueAnniversaires = mois;
      await rechargerEtRendre();
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`);
      bouton.disabled = false;
      bouton.textContent = estNouveau ? 'Ajouter' : 'Enregistrer';
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, estNouveau ? 'Nouvel anniversaire' : a.nom),
    el('label', { class: 'champ' }, el('span', {}, 'Prénom ou nom'), champNom),
    el('div', { class: 'champ-duo' },
      el('label', { class: 'champ' }, el('span', {}, 'Jour'), champJour),
      el('label', { class: 'champ' }, el('span', {}, 'Mois'), champMois)),
    el('label', { class: 'champ' },
      el('span', {}, 'Année de naissance'), champAnnee),
    el('p', { class: 'feuille-info' },
      'Laisse l’année vide si tu ne la connais pas : l’âge ne sera simplement pas affiché.'),
    el('label', { class: 'champ' }, el('span', {}, 'Prévoir un cadeau ?'), cadeau),
    el('label', { class: 'champ' }, el('span', {}, 'Note'), champNote),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer },
      estNouveau ? 'Ajouter' : 'Enregistrer'),
    estNouveau
      ? el('button', { class: 'btn btn-discret', onclick: fermerFeuille }, 'Annuler')
      : el('button', { class: 'btn btn-danger', onclick: () => supprimer(a) }, 'Supprimer'),
  ));
}

async function supprimer(a) {
  fermerFeuille();
  const oui = await confirmer(`Supprimer l’anniversaire de ${a.nom} ?`, {
    texteOk: 'Supprimer', danger: true,
  });
  if (!oui) return;
  try {
    await db.supprimerAnniversaire(a.id);
    await rechargerEtRendre();
  } catch (e) {
    toast(`Suppression impossible : ${e.message}`);
  }
}

// ══════════════════ Onglets de mois ══════════════════

/** Construit la rangée de pastilles une seule fois, au démarrage. */
export function construireOngletsMois() {
  const hote = vider($('#onglets-anniversaires'));

  const ajouter = (cle, libelle) => {
    hote.append(el('button', {
      class: `puce ${etat.vueAnniversaires === cle ? 'on' : ''}`,
      dataset: { vueAnniv: String(cle) },
      onclick: (e) => {
        etat.vueAnniversaires = cle;
        for (const b of hote.children) b.classList.toggle('on', b === e.currentTarget);
        rendreAnniversaires();
        e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      },
    }, libelle));
  };

  ajouter('a_venir', 'À venir');
  MOIS.forEach((nom, i) => ajouter(i + 1, nom.charAt(0).toUpperCase() + nom.slice(1)));
}

async function rechargerEtRendre() {
  etat.anniversaires = await db.chargerAnniversaires(etat.espaceId);
  construireOngletsMois();
  rendreAnniversaires();
}
