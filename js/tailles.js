// Module « Guide des tailles » : les tailles de chacun, marque par marque,
// pour que l'autre puisse prendre l'initiative d'un cadeau sans demander.
//
// Un onglet par personne. Chacun tient les siennes ; l'onglet de l'autre se
// lit sans se modifier — la base le refuse de toute façon (schema-v10.sql).

import {
  $, el, vider, montrer, toast, ouvrirFeuille, fermerFeuille, confirmer,
} from './ui.js';
import { etat, partenaire, pseudoDe } from './etat.js';
import { TYPES_VETEMENT, libelleDe } from './config.js';
import * as db from './db.js';

/** L'onglet affiché par défaut est celui de l'autre : on vient surtout ici
 *  pour consulter ses tailles, les siennes on les connaît. */
function ongletCourant() {
  const ids = etat.membres.map((m) => m.id);
  if (!ids.includes(etat.ongletTailles)) {
    etat.ongletTailles = partenaire()?.id || etat.membreId;
  }
  return etat.ongletTailles;
}

/** « Zara » et « zara » sont la même marque : on regroupe sans tenir compte
 *  de la casse ni des espaces, et on affiche la graphie de la première saisie. */
const cleMarque = (marque) => marque.trim().toLocaleLowerCase('fr');

const rangType = (type) => {
  const i = TYPES_VETEMENT.findIndex((t) => t.cle === type);
  return i === -1 ? TYPES_VETEMENT.length : i;
};

// ══════════════════ Rendu ══════════════════

export function rendreTailles() {
  const membreId = ongletCourant();
  const estMoi = membreId === etat.membreId;

  rendreOnglets(membreId);
  montrer($('[data-action="nouvelle-taille"]'), estMoi);

  const hote = vider($('#contenu-tailles'));
  const lignes = etat.tailles.filter((t) => t.membre_id === membreId);
  const prenom = pseudoDe(membreId);

  if (!lignes.length) {
    hote.append(el('div', { class: 'anniv-vide' }, estMoi
      ? [el('p', {}, 'Aucune taille pour l’instant.'),
        el('p', { class: 'feuille-info' },
          `Ajoute les tiennes avec le bouton + : ${partenaire()?.pseudo || 'l’autre'} `
          + 'pourra s’en servir pour te faire une surprise.')]
      : [el('p', {}, `${prenom} n’a encore rien noté.`),
        el('p', { class: 'feuille-info' },
          `Ses tailles apparaîtront ici dès qu’${prenom} les aura saisies.`)]));
    return;
  }

  if (!estMoi) {
    hote.append(el('p', { class: 'feuille-info tailles-info' },
      `Tenu par ${prenom}, en lecture seule ici.`));
  }

  // Regroupement par marque, marques dans l'ordre alphabétique.
  const parMarque = new Map();
  for (const t of lignes) {
    const cle = cleMarque(t.marque);
    if (!parMarque.has(cle)) parMarque.set(cle, { nom: t.marque.trim(), lignes: [] });
    parMarque.get(cle).lignes.push(t);
  }
  const marques = [...parMarque.values()]
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));

  for (const marque of marques) {
    hote.append(el('h3', { class: 'anniv-mois-titre' }, marque.nom));
    marque.lignes
      .sort((a, b) => rangType(a.type) - rangType(b.type))
      .forEach((t) => hote.append(ligne(t, estMoi)));
  }
}

function rendreOnglets(membreId) {
  const hote = vider($('#onglets-tailles'));
  // Tant que l'autre n'a pas rejoint l'espace, un seul onglet : inutile.
  montrer(hote, etat.membres.length > 1);
  for (const m of etat.membres) {
    hote.append(el('button', {
      class: m.id === membreId ? 'on' : '',
      role: 'tab',
      onclick: () => { etat.ongletTailles = m.id; rendreTailles(); },
    }, m.pseudo));
  }
}

function ligne(t, modifiable) {
  const contenu = [
    el('div', { class: 'taille-corps' },
      el('p', { class: 'taille-type' }, libelleDe(TYPES_VETEMENT, t.type)),
      t.precisions ? el('p', { class: 'taille-precisions' }, t.precisions) : null),
    el('span', { class: 'taille-valeur' }, t.taille),
  ];
  // Une ligne de l'autre n'est pas un bouton : rien ne doit laisser croire
  // qu'on peut la toucher.
  return modifiable
    ? el('button', { class: 'taille', onclick: () => ouvrirFiche(t) }, contenu)
    : el('div', { class: 'taille' }, contenu);
}

// ══════════════════ Saisie ══════════════════

export function ouvrirNouvelleTaille() {
  ouvrirFiche(null);
}

function ouvrirFiche(existant) {
  const estNouveau = !existant;
  const t = existant || {};

  // Les marques déjà saisies sont proposées pendant la frappe : c'est ce qui
  // évite d'avoir « Sézane » et « Sezane » en deux groupes.
  const mesMarques = [...new Map(etat.tailles
    .filter((x) => x.membre_id === etat.membreId)
    .map((x) => [cleMarque(x.marque), x.marque.trim()])).values()]
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  const suggestions = el('datalist', { id: 'marques-saisies' },
    mesMarques.map((m) => el('option', { value: m })));

  const champMarque = el('input', {
    type: 'text', value: t.marque || '', maxlength: 40,
    placeholder: 'Zara, Sézane, Nike…', autocapitalize: 'words',
  });
  // `list` est en lecture seule côté JavaScript : `el` ne peut pas l'affecter,
  // il passe par l'attribut.
  champMarque.setAttribute('list', 'marques-saisies');
  const champType = el('select', {},
    TYPES_VETEMENT.map((x) => el('option', {
      value: x.cle, selected: (t.type || TYPES_VETEMENT[0].cle) === x.cle,
    }, x.libelle)));
  const champTaille = el('input', {
    type: 'text', value: t.taille || '', maxlength: 20, placeholder: 'M, 38, 42 EU, 85B…',
  });
  const champPrecisions = el('textarea', {
    rows: 3, maxlength: 300, value: t.precisions || '',
    placeholder: 'Taille petit, prendre au-dessus ; coupe slim ; couleur préférée…',
  });

  const enregistrer = async (e) => {
    const marque = champMarque.value.trim();
    const taille = champTaille.value.trim();
    if (!marque) { toast('Il manque la marque'); return; }
    if (!taille) { toast('Il manque la taille'); return; }

    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';
    const ligneBase = {
      marque, taille, type: champType.value,
      precisions: champPrecisions.value.trim() || null,
    };
    try {
      if (estNouveau) {
        await db.creerTaille({ ...ligneBase, espace_id: etat.espaceId, membre_id: etat.membreId });
      } else {
        await db.majTaille(t.id, ligneBase);
      }
      fermerFeuille();
      await rechargerEtRendre();
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`);
      bouton.disabled = false;
      bouton.textContent = estNouveau ? 'Ajouter' : 'Enregistrer';
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, estNouveau ? 'Nouvelle taille' : `${t.marque} · ${libelleDe(TYPES_VETEMENT, t.type)}`),
    el('label', { class: 'champ' }, el('span', {}, 'Marque'), champMarque),
    suggestions,
    el('div', { class: 'champ-duo' },
      el('label', { class: 'champ' }, el('span', {}, 'Vêtement'), champType),
      el('label', { class: 'champ' }, el('span', {}, 'Taille'), champTaille)),
    el('label', { class: 'champ' }, el('span', {}, 'Précisions'), champPrecisions),
    el('button', { class: 'btn btn-primaire', onclick: enregistrer },
      estNouveau ? 'Ajouter' : 'Enregistrer'),
    estNouveau
      ? el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler')
      : el('button', { class: 'btn btn-destructif', onclick: () => supprimer(t) }, 'Supprimer'),
  ));
}

async function supprimer(t) {
  fermerFeuille();
  const oui = await confirmer(
    `Supprimer ${libelleDe(TYPES_VETEMENT, t.type).toLocaleLowerCase('fr')} chez ${t.marque} ?`,
    { texteOk: 'Supprimer', danger: true },
  );
  if (!oui) return;
  try {
    await db.supprimerTaille(t.id);
    await rechargerEtRendre();
  } catch (e) {
    toast(`Suppression impossible : ${e.message}`);
  }
}

async function rechargerEtRendre() {
  etat.tailles = await db.chargerTailles(etat.espaceId);
  rendreTailles();
}
