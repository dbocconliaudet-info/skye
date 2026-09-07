// Module « Tricount » : qui a payé quoi, et qui doit combien à qui.
//
// À deux, la question « qui rembourse qui » se réduit à un seul nombre. C'est
// toute la différence avec l'application dont ce module reprend le nom, qui
// doit compenser des dettes croisées entre cinq personnes : ici, un solde
// positif d'un côté est exactement le solde négatif de l'autre.

import {
  $, el, vider, toast, ouvrirFeuille, fermerFeuille, confirmer, groupeOptions,
  aujourdhui, formaterDate,
} from './ui.js';
import { etat, pseudoDe, moi, partenaire } from './etat.js';
import * as db from './db.js';

// ══════════════════ Montants ══════════════════
//
// Tout est compté en centimes entiers. Voir l'en-tête de schema-v3.sql pour
// la raison : les nombres à virgule d'un ordinateur ne tombent pas juste, et
// un solde qui dérive d'un centime tous les dix jours est indéfendable.

const fmtEuros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export const formaterMontant = (cents) => fmtEuros.format(cents / 100);

/** « 12,50 » « 12.5 » « 12 € » « 1 200,00 » → centimes. NaN si illisible. */
export function enCentimes(saisie) {
  const texte = String(saisie ?? '')
    .replace(/\s| |€/g, '')
    .replace(',', '.');
  if (!/^\d*\.?\d*$/.test(texte) || texte === '' || texte === '.') return NaN;
  // Passer par une chaîne plutôt que par Math.round(x * 100) : 19.99 * 100
  // vaut 1998.9999999999998 en virgule flottante, donc 1998 une fois tronqué.
  const [entier, decimales = ''] = texte.split('.');
  return Number(entier || 0) * 100 + Number(`${decimales}00`.slice(0, 2));
}

// ══════════════════ Solde ══════════════════

/** Ce que cette ligne rapporte (positif) ou coûte (négatif) à `membreId`.
 *  Une seule formule pour les trois natures de ligne — dépense partagée,
 *  avance faite à l'autre, remboursement — parce qu'elles disent toutes la
 *  même chose : quelqu'un a sorti l'argent, quelqu'un en supporte la charge. */
function effetSur(d, membreId) {
  if (!d.paye_par) return 0;            // payeur effacé : la ligne ne veut plus rien dire
  const partPayeur = d.pour_les_deux
    ? Math.round(d.montant_cents / 2)
    : (d.pour_membre === d.paye_par ? d.montant_cents : 0);
  const dûAuPayeur = d.montant_cents - partPayeur;
  if (d.paye_par === membreId) return dûAuPayeur;
  return -dûAuPayeur;
}

/** Solde de `membreId` : positif, on lui doit ; négatif, il doit. */
export const soldeDe = (membreId) =>
  etat.depenses.reduce((total, d) => total + effetSur(d, membreId), 0);

// ══════════════════ Rendu ══════════════════

export function rendreTricount() {
  const hote = vider($('#contenu-tricount'));

  if (!etat.membres.length) {
    hote.append(el('p', { class: 'colonne-vide' }, 'Chargement…'));
    return;
  }

  hote.append(carteSolde());

  if (!etat.depenses.length) {
    hote.append(el('div', { class: 'tricount-vide' },
      el('p', {}, 'Aucune dépense pour l’instant.'),
      el('p', { class: 'feuille-info' },
        'Ajoutez votre première dépense avec le bouton +, ou reprenez le solde '
        + 'que vous avez aujourd’hui dans Tricount pour continuer ici.'),
      boutonSoldeInitial()));
    return;
  }

  let moisAffiche = '';
  for (const d of etat.depenses) {
    const mois = (d.date_depense || '').slice(0, 7);
    if (mois !== moisAffiche) {
      moisAffiche = mois;
      hote.append(el('h3', { class: 'tricount-mois' }, libelleMois(d.date_depense)));
    }
    hote.append(ligneDepense(d));
  }

  const reprise = boutonSoldeInitial();
  if (reprise) hote.append(el('div', { class: 'tricount-reprise' }, reprise));
}

const fmtMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

function libelleMois(iso) {
  if (!iso) return '';
  const [a, m] = iso.split('-').map(Number);
  const texte = fmtMois.format(new Date(a, m - 1, 1));
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function carteSolde() {
  const monSolde = soldeDe(etat.membreId);
  const autre = partenaire();

  if (monSolde === 0) {
    return el('div', { class: 'solde solde-nul' },
      el('p', { class: 'solde-phrase' }, 'Vous êtes à égalité.'),
      el('p', { class: 'solde-detail' }, 'Personne ne doit rien à personne.'));
  }

  const jeSuisCreancier = monSolde > 0;
  const qui = autre ? autre.pseudo : 'ton/ta partenaire';

  return el('div', { class: `solde ${jeSuisCreancier ? 'solde-positif' : 'solde-negatif'}` },
    el('p', { class: 'solde-phrase' }, jeSuisCreancier ? `${qui} te doit` : `Tu dois à ${qui}`),
    el('p', { class: 'solde-montant' }, formaterMontant(Math.abs(monSolde))),
    autre
      ? el('button', { class: 'btn btn-secondaire', onclick: ouvrirSolder }, 'On solde les comptes')
      : null,
  );
}

function ligneDepense(d) {
  const payeur = pseudoDe(d.paye_par) || 'quelqu’un';
  const partage = d.pour_les_deux
    ? 'moitié-moitié'
    : `pour ${pseudoDe(d.pour_membre) || '—'}`;

  const classes = ['depense'];
  if (d.type !== 'depense') classes.push('depense-reglement');

  return el('button', {
    class: classes.join(' '),
    onclick: () => ouvrirDepense(d),
  },
    el('div', { class: 'depense-corps' },
      el('p', { class: 'depense-libelle' }, d.libelle),
      el('p', { class: 'depense-meta' },
        `${formaterDate(d.date_depense)} · payé par ${payeur}`,
        d.type === 'depense' ? ` · ${partage}` : ''),
    ),
    el('span', { class: 'depense-montant' }, formaterMontant(d.montant_cents)),
  );
}

/** N'apparaît que tant qu'aucun solde n'a été repris : la base n'en accepte
 *  qu'un seul par espace, et deux reprises fausseraient tout sans prévenir. */
function boutonSoldeInitial() {
  if (etat.depenses.some((d) => d.type === 'solde_initial')) return null;
  return el('button', {
    class: 'btn btn-fantome',
    onclick: ouvrirSoldeInitial,
  }, 'Reprendre un solde Tricount');
}

// ══════════════════ Saisie ══════════════════

/** Champ montant partagé par les trois formulaires. `inputmode="decimal"`
 *  sort le pavé numérique sur téléphone sans imposer le point du clavier
 *  anglais : on accepte la virgule, qui est ce que tout le monde tape. */
function champMontant(valeurCents) {
  return el('input', {
    type: 'text', inputmode: 'decimal', placeholder: '0,00',
    value: valeurCents ? String(valeurCents / 100).replace('.', ',') : '',
    enterkeyhint: 'done',
  });
}

export function ouvrirNouvelleDepense() {
  ouvrirDepense(null);
}

function ouvrirDepense(existante) {
  const autre = partenaire();
  if (!autre) {
    toast('Il faut être deux dans l’espace pour partager une dépense');
    return;
  }
  // Une ligne de reprise ou de remboursement n'a pas de « partage » à régler :
  // on la modifie dans son propre formulaire plutôt que dans celui-ci.
  if (existante && existante.type !== 'depense') {
    ouvrirLigneSimple(existante);
    return;
  }

  const estNouvelle = !existante;
  const d = existante || {};

  const champLibelle = el('input', {
    type: 'text', value: d.libelle || '', maxlength: 60,
    placeholder: 'Courses, restaurant, essence…',
  });
  const montant = champMontant(d.montant_cents);
  const champDate = el('input', { type: 'date', value: d.date_depense || aujourdhui() });

  const payeurInitial = d.paye_par || etat.membreId;
  const payeur = groupeOptions(
    etat.membres.map((m) => ({ cle: m.id, libelle: m.pseudo })), payeurInitial);

  const pourInitial = estNouvelle || d.pour_les_deux ? 'deux' : d.pour_membre;
  const pour = groupeOptions([
    { cle: 'deux', libelle: 'Moitié-moitié' },
    ...etat.membres.map((m) => ({ cle: m.id, libelle: `Pour ${m.pseudo}` })),
  ], pourInitial, { vert: true });

  const enregistrer = async (e) => {
    const libelle = champLibelle.value.trim();
    const cents = enCentimes(montant.value);
    if (!libelle) { toast('Il manque le libellé'); return; }
    if (!Number.isFinite(cents) || cents <= 0) { toast('Montant invalide'); return; }

    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';
    const ligne = {
      libelle,
      montant_cents: cents,
      paye_par: payeur.valeur,
      pour_les_deux: pour.valeur === 'deux',
      pour_membre: pour.valeur === 'deux' ? null : pour.valeur,
      date_depense: champDate.value || aujourdhui(),
    };
    try {
      if (estNouvelle) {
        await db.creerDepense({ ...ligne, espace_id: etat.espaceId, cree_par: etat.membreId });
      } else {
        await db.majDepense(d.id, ligne);
      }
      fermerFeuille();
      await rechargerEtRendre();
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`);
      bouton.disabled = false;
      bouton.textContent = estNouvelle ? 'Ajouter' : 'Enregistrer';
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, estNouvelle ? 'Nouvelle dépense' : 'Modifier la dépense'),
    el('label', { class: 'champ' }, el('span', {}, 'Montant'), montant),
    el('label', { class: 'champ' }, el('span', {}, 'Libellé'), champLibelle),
    el('label', { class: 'champ' }, el('span', {}, 'Qui a payé ?'), payeur),
    el('label', { class: 'champ' }, el('span', {}, 'Pour qui ?'), pour),
    el('label', { class: 'champ' }, el('span', {}, 'Date'), champDate),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer },
      estNouvelle ? 'Ajouter' : 'Enregistrer'),
    estNouvelle
      ? el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler')
      : el('button', { class: 'btn btn-destructif', onclick: () => supprimer(d) }, 'Supprimer'),
  ));
}

/** Remboursements et solde repris : un montant, un sens, rien d'autre. */
function ouvrirLigneSimple(d) {
  const montant = champMontant(d.montant_cents);
  const estReprise = d.type === 'solde_initial';

  const enregistrer = async (e) => {
    const cents = enCentimes(montant.value);
    if (!Number.isFinite(cents) || cents <= 0) { toast('Montant invalide'); return; }
    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';
    try {
      await db.majDepense(d.id, { montant_cents: cents });
      fermerFeuille();
      await rechargerEtRendre();
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`);
      bouton.disabled = false;
      bouton.textContent = 'Enregistrer';
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, estReprise ? 'Solde repris de Tricount' : 'Remboursement'),
    el('p', { class: 'feuille-info' },
      `${pseudoDe(d.paye_par)} → ${pseudoDe(d.pour_membre)}, le ${formaterDate(d.date_depense)}.`),
    el('label', { class: 'champ' }, el('span', {}, 'Montant'), montant),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, 'Enregistrer'),
    el('button', { class: 'btn btn-destructif', onclick: () => supprimer(d) }, 'Supprimer'),
  ));
}

async function supprimer(d) {
  fermerFeuille();
  const oui = await confirmer('Supprimer cette ligne ?', {
    detail: `« ${d.libelle} », ${formaterMontant(d.montant_cents)}. Le solde sera recalculé.`,
    texteOk: 'Supprimer', danger: true,
  });
  if (!oui) return;
  try {
    await db.supprimerDepense(d.id);
    await rechargerEtRendre();
  } catch (e) {
    toast(`Suppression impossible : ${e.message}`);
  }
}

// ══════════════════ Solder les comptes ══════════════════

function ouvrirSolder() {
  const autre = partenaire();
  const monSolde = soldeDe(etat.membreId);
  if (!autre || monSolde === 0) return;

  // Celui qui doit paie l'autre. Le remboursement s'enregistre exactement
  // comme une avance : payeur = le débiteur, charge = le créancier.
  const jeDois = monSolde < 0;
  const debiteur = jeDois ? moi() : autre;
  const crediteur = jeDois ? autre : moi();
  const montant = champMontant(Math.abs(monSolde));

  const enregistrer = async (e) => {
    const cents = enCentimes(montant.value);
    if (!Number.isFinite(cents) || cents <= 0) { toast('Montant invalide'); return; }
    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';
    try {
      await db.creerDepense({
        espace_id: etat.espaceId,
        libelle: `Remboursement de ${debiteur.pseudo} à ${crediteur.pseudo}`,
        montant_cents: cents,
        paye_par: debiteur.id,
        pour_membre: crediteur.id,
        pour_les_deux: false,
        type: 'remboursement',
        date_depense: aujourdhui(),
        cree_par: etat.membreId,
      });
      fermerFeuille();
      await rechargerEtRendre();
      toast('Comptes soldés');
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`);
      bouton.disabled = false;
      bouton.textContent = 'Enregistrer le remboursement';
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'On solde les comptes'),
    el('p', { class: 'feuille-info' },
      `${debiteur.pseudo} rembourse ${crediteur.pseudo}. Le montant est pré-rempli avec le `
      + 'solde actuel — tu peux le modifier si vous ne réglez qu’une partie.'),
    el('label', { class: 'champ' }, el('span', {}, 'Montant remboursé'), montant),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, 'Enregistrer le remboursement'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

// ══════════════════ Reprise du solde Tricount ══════════════════

function ouvrirSoldeInitial() {
  const autre = partenaire();
  if (!autre) { toast('Il faut être deux dans l’espace'); return; }

  const montant = champMontant(0);
  const sens = groupeOptions([
    { cle: 'on_me_doit', libelle: `${autre.pseudo} me doit` },
    { cle: 'je_dois', libelle: `Je dois à ${autre.pseudo}` },
  ], 'on_me_doit', { vert: true });

  const enregistrer = async (e) => {
    const cents = enCentimes(montant.value);
    if (!Number.isFinite(cents) || cents <= 0) { toast('Montant invalide'); return; }
    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';

    // « L'autre me doit 62 € » s'écrit comme une avance de 62 € que je lui
    // aurais faite : même arithmétique, une seule ligne, aucun cas particulier
    // dans le calcul du solde.
    const onMeDoit = sens.valeur === 'on_me_doit';
    try {
      await db.creerDepense({
        espace_id: etat.espaceId,
        libelle: 'Solde repris de Tricount',
        montant_cents: cents,
        paye_par: onMeDoit ? etat.membreId : autre.id,
        pour_membre: onMeDoit ? autre.id : etat.membreId,
        pour_les_deux: false,
        type: 'solde_initial',
        date_depense: aujourdhui(),
        cree_par: etat.membreId,
      });
      fermerFeuille();
      await rechargerEtRendre();
    } catch (err) {
      // L'index unique de la base refuse une seconde reprise : c'est le cas
      // de deux téléphones qui la saisissent en même temps.
      const message = err.message.includes('depenses_un_solde_initial')
        ? 'Un solde a déjà été repris dans cet espace'
        : err.message;
      toast(`Enregistrement impossible : ${message}`);
      bouton.disabled = false;
      bouton.textContent = 'Reprendre ce solde';
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'Reprendre un solde Tricount'),
    el('p', { class: 'feuille-info' },
      'Saisis le solde affiché aujourd’hui dans Tricount, et continuez ici. '
      + 'Ça ne se fait qu’une fois.'),
    el('label', { class: 'champ' }, el('span', {}, 'Dans quel sens ?'), sens),
    el('label', { class: 'champ' }, el('span', {}, 'Montant'), montant),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, 'Reprendre ce solde'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

// ══════════════════ Rechargement ══════════════════

async function rechargerEtRendre() {
  etat.depenses = await db.chargerDepenses(etat.espaceId);
  rendreTricount();
}
