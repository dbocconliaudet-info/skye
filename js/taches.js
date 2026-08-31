// Module « On s'en occupe » (§6 du cahier des charges).

import {
  $, el, vider, montrer, toast, ouvrirFeuille, fermerFeuille, confirmer, groupeOptions,
  aujourdhui, versIso, depuisIso, formaterDate, formaterDateHeure, joursRestants, ajouterDelai,
} from './ui.js';
import { etat, pseudoDe } from './etat.js';
import { CATEGORIES, PRIORITES, STATUTS, FREQUENCES, libelleDe } from './config.js';
import * as db from './db.js';

// ══════════════════ Récurrence ══════════════════

/** Échéance suivante d'une tâche récurrente, en gérant les mois courts :
 *  « tous les mois le 31 » tombe au 28 ou 30 quand le 31 n'existe pas. */
function prochaineEcheance(iso, rec) {
  const n = Math.max(1, Number(rec.intervalle) || 1);
  const d = depuisIso(iso);

  if (rec.frequence === 'jour') { d.setDate(d.getDate() + n); return versIso(d); }
  if (rec.frequence === 'semaine') { d.setDate(d.getDate() + 7 * n); return versIso(d); }

  const moisEnPlus = rec.frequence === 'annee' ? 12 * n : n;
  const jourVoulu = rec.frequence === 'mois' ? (Number(rec.jour) || d.getDate()) : d.getDate();
  const cible = new Date(d.getFullYear(), d.getMonth() + moisEnPlus, 1);
  const dernierJour = new Date(cible.getFullYear(), cible.getMonth() + 1, 0).getDate();
  cible.setDate(Math.min(jourVoulu, dernierJour));
  return versIso(cible);
}

/** Date à partir de laquelle la carte apparaît sur le board (§6.3). */
function dateApparition(isoEcheance, rec) {
  if (!rec || !rec.delai_nb) return isoEcheance;
  return versIso(ajouterDelai(depuisIso(isoEcheance), -Number(rec.delai_nb), rec.delai_unite || 'jour'));
}

function estVisible(t) {
  if (!t.recurrence || !t.date_limite || !t.recurrence.delai_nb) return true;
  return dateApparition(t.date_limite, t.recurrence) <= aujourdhui();
}

/**
 * Fait apparaître les occurrences dont la date d'apparition est arrivée.
 *
 * Volontairement décorrélé de la clôture : le cahier des charges (§6.3) exige
 * qu'une occurrence non traitée ne bloque pas la suivante. On repart donc de
 * l'échéance la plus lointaine de chaque série et on avance jusqu'à aujourd'hui,
 * sans se soucier de savoir si les précédentes ont été faites.
 */
export async function genererOccurrencesDues() {
  const dernieres = new Map();
  for (const t of etat.taches) {
    const serie = t.recurrence && t.recurrence.serie;
    if (!serie || !t.date_limite) continue;
    const connue = dernieres.get(serie);
    if (!connue || t.date_limite > connue.date_limite) dernieres.set(serie, t);
  }

  let creees = 0;
  for (const modele of dernieres.values()) {
    let echeance = modele.date_limite;
    // Garde-fou : une app laissée fermée un an ne doit pas créer 365 cartes.
    for (let garde = 0; garde < 24; garde++) {
      const suivante = prochaineEcheance(echeance, modele.recurrence);
      if (!suivante || suivante <= echeance) break;
      if (dateApparition(suivante, modele.recurrence) > aujourdhui()) break;

      const occurrence = await db.creerOccurrence({
        espace_id: modele.espace_id,
        titre: modele.titre,
        description: modele.description,
        assigne_a: modele.assigne_a,
        assigne_aux_deux: modele.assigne_aux_deux,
        categorie: modele.categorie,
        priorite: modele.priorite,
        statut: 'a_faire',
        date_limite: suivante,
        recurrence: modele.recurrence,
        cree_par: modele.cree_par,
      });
      if (occurrence) { etat.taches.push(occurrence); creees++; }
      echeance = suivante;
    }
  }
  return creees;
}

// ══════════════════ Sélection et tri ══════════════════

/** Colonnes du board selon le mode de regroupement choisi (§3 des évolutions).
 *  `visibles` sert au mode Catégorie, seul à masquer ses colonnes vides : une
 *  colonne « Vacances » vide neuf mois par an ferait défiler pour rien. */
function colonnes(visibles) {
  if (etat.groupement === 'categorie') {
    const utilisees = new Set(visibles.map((t) => t.categorie));
    return CATEGORIES
      .filter((c) => utilisees.has(c.cle))
      .map((c) => ({ cle: c.cle, titre: c.libelle }));
  }

  if (etat.groupement === 'priorite') {
    // De la plus urgente à la moins urgente : on lit un board de gauche à
    // droite, autant y trouver ce qui presse en premier.
    return [...PRIORITES].reverse().map((p) => ({ cle: p.cle, titre: p.libelle }));
  }

  const [m1, m2] = etat.membres;
  return [
    m1 && { cle: m1.id, titre: m1.pseudo },
    m2 && { cle: m2.id, titre: m2.pseudo },
    { cle: 'deux', titre: 'Les deux' },
  ].filter(Boolean);
}

function colonneDe(t) {
  if (etat.groupement === 'categorie') return t.categorie;
  if (etat.groupement === 'priorite') return t.priorite;
  if (t.assigne_aux_deux || !t.assigne_a) return 'deux';
  return t.assigne_a;
}

function tachesAffichees() {
  if (etat.ongletTaches === 'historique') {
    return etat.taches.filter((t) => {
      const close = t.statut === 'fait';
      if (etat.filtreHisto === 'fait') return close;
      if (etat.filtreHisto === 'sans_objet') return t.devenu_sans_objet;
      return close || t.devenu_sans_objet;
    });
  }
  return etat.taches.filter((t) => t.statut !== 'fait' && !t.devenu_sans_objet && estVisible(t));
}

const RANG_PRIORITE = { haute: 0, moyenne: 1, basse: 2 };

function trier(liste) {
  if (etat.ongletTaches === 'historique') {
    return [...liste].sort((a, b) =>
      (b.termine_le || b.cree_le).localeCompare(a.termine_le || a.cree_le));
  }
  return [...liste].sort((a, b) => {
    // Les échéances d'abord, du plus urgent au plus lointain ; sans date ensuite.
    if (a.date_limite !== b.date_limite) {
      if (!a.date_limite) return 1;
      if (!b.date_limite) return -1;
      return a.date_limite.localeCompare(b.date_limite);
    }
    const p = RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite];
    return p !== 0 ? p : b.cree_le.localeCompare(a.cree_le);
  });
}

// ══════════════════ Rendu du board ══════════════════

export function rendreTaches() {
  montrer($('#filtres-historique'), etat.ongletTaches === 'historique');

  const hote = vider($('#colonnes-taches'));
  const visibles = tachesAffichees();

  if (!etat.membres.length) {
    hote.append(el('p', { class: 'colonne-vide' }, 'Chargement…'));
    return;
  }

  const cols = colonnes(visibles);
  if (!cols.length) {
    hote.append(el('p', { class: 'colonne-vide' },
      etat.ongletTaches === 'historique' ? 'Rien encore ici.' : 'Rien à faire. Profitez-en !'));
    return;
  }

  for (const col of cols) {
    const lot = trier(visibles.filter((t) => colonneDe(t) === col.cle));
    const boite = el('div', { class: 'colonne' },
      el('h3', {}, col.titre, el('span', { class: 'compteur' }, String(lot.length))),
    );
    if (!lot.length) {
      boite.append(el('p', { class: 'colonne-vide' },
        etat.ongletTaches === 'historique' ? 'Rien encore ici.' : 'Rien à faire. Profitez-en !'));
    }
    for (const t of lot) boite.append(carte(t));
    hote.append(boite);
  }
}

function carte(t) {
  const retard = t.statut !== 'fait' && t.date_limite && joursRestants(t.date_limite) < 0;
  const classes = ['carte'];
  if (retard) classes.push('est-retard');
  if (t.statut === 'fait') classes.push('est-close');
  if (t.devenu_sans_objet) classes.push('est-sans-objet');

  const meta = [];
  meta.push(el('span', { class: `point ${t.priorite}` }));
  if (t.date_limite) {
    meta.push(el('span', { class: retard ? 'retard' : '' },
      (retard ? 'En retard · ' : '') + formaterDate(t.date_limite)));
  }
  if (t.recurrence) meta.push(el('span', { title: 'Tâche récurrente' }, '↻'));
  if (t.statut === 'en_cours') meta.push(el('span', { class: 'badge-statut' }, 'En cours'));
  if (t.devenu_sans_objet) meta.push(el('span', { class: 'badge-statut badge-neutre' }, 'Sans objet'));
  if (t.statut === 'fait' && t.termine_par) {
    meta.push(el('span', {}, `Fait par ${pseudoDe(t.termine_par)}`));
  }

  return el('button', { class: classes.join(' '), onclick: () => ouvrirDetail(t.id) },
    el('span', { class: `etiquette cat-${t.categorie}` }, libelleDe(CATEGORIES, t.categorie)),
    el('div', { class: 'titre' }, t.titre),
    el('div', { class: 'meta' }, meta),
  );
}

// ══════════════════ Fiche détaillée ══════════════════

function ouvrirDetail(id) {
  const t = etat.taches.find((x) => x.id === id);
  if (!t) return;

  const assignation = t.assigne_aux_deux || !t.assigne_a
    ? 'Les deux' : pseudoDe(t.assigne_a);

  const infos = [
    ['Catégorie', libelleDe(CATEGORIES, t.categorie)],
    ['Assignée à', assignation],
    ['Priorité', libelleDe(PRIORITES, t.priorite)],
    t.date_limite && ['Échéance', formaterDate(t.date_limite)],
    t.recurrence && ['Récurrence', decrireRecurrence(t.recurrence)],
    ['Créée par', `${pseudoDe(t.cree_par) || 'quelqu’un'}, le ${formaterDateHeure(t.cree_le)}`],
    t.termine_le && ['Clôturée par', `${pseudoDe(t.termine_par)}, le ${formaterDateHeure(t.termine_le)}`],
  ].filter(Boolean);

  const statuts = groupeOptions(STATUTS, t.statut, {
    vert: true,
    onChange: (nouveau) => {
      fermerFeuille();
      if (nouveau === 'fait') demanderNoteDeCloture(t);
      else appliquer(t.id, { statut: nouveau, termine_le: null, termine_par: null });
    },
  });

  ouvrirFeuille(el('div', {},
    el('h2', {}, t.titre),
    t.description ? el('p', { class: 'feuille-info' }, t.description) : null,

    el('p', { class: 'recap' }, infos.flatMap(([k, v], i) => [
      i ? el('br') : null, el('strong', {}, `${k} : `), v,
    ])),

    t.note_de_cloture
      ? el('p', { class: 'feuille-info' }, `« ${t.note_de_cloture} »`)
      : null,

    el('div', { class: 'separateur' }),
    el('p', { class: 'options-titre' }, 'Où en est-on ?'),
    statuts,

    el('label', { class: 'bascule' },
      el('input', {
        type: 'checkbox',
        checked: t.devenu_sans_objet,
        onchange: (e) => {
          fermerFeuille();
          appliquer(t.id, { devenu_sans_objet: e.target.checked });
        },
      }),
      el('span', {}, 'Devenu sans objet',
        el('span', { class: 'sous' }, 'Se cumule avec le statut : la tâche part dans l’historique.')),
    ),

    el('div', { class: 'separateur' }),
    el('button', {
      class: 'btn btn-doux',
      onclick: () => { fermerFeuille(); ouvrirFormulaire(t); },
    }, 'Modifier la tâche'),
    el('button', {
      class: 'btn btn-danger',
      onclick: async () => {
        fermerFeuille();
        const oui = await confirmer('Supprimer cette tâche ?', {
          detail: 'Elle disparaîtra aussi de l’historique, définitivement.',
          texteOk: 'Supprimer', danger: true,
        });
        if (!oui) return;
        await db.supprimerTache(t.id);
        etat.taches = etat.taches.filter((x) => x.id !== t.id);
        rendreTaches();
        toast('Tâche supprimée');
      },
    }, 'Supprimer'),
  ));
}

const TOURNURES = {
  jour: { seul: 'tous les jours', multiple: (n) => `tous les ${n} jours` },
  semaine: { seul: 'toutes les semaines', multiple: (n) => `toutes les ${n} semaines` },
  mois: { seul: 'tous les mois', multiple: (n) => `tous les ${n} mois` },
  annee: { seul: 'tous les ans', multiple: (n) => `tous les ${n} ans` },
};

function decrireRecurrence(rec) {
  const n = Math.max(1, Number(rec.intervalle) || 1);
  const tournure = TOURNURES[rec.frequence];
  let texte = tournure ? (n === 1 ? tournure.seul : tournure.multiple(n)) : 'récurrente';

  if (rec.frequence === 'mois' && rec.jour) texte += `, le ${rec.jour}`;

  const delai = Number(rec.delai_nb) || 0;
  if (delai > 0) {
    // « mois » est invariable, contrairement à « jour » et « semaine ».
    const unite = rec.delai_unite === 'mois' ? 'mois' : `${rec.delai_unite}${delai > 1 ? 's' : ''}`;
    texte += ` — visible ${delai} ${unite} avant`;
  }
  return texte;
}

async function appliquer(id, patch) {
  try {
    const maj = await db.majTache(id, patch);
    const i = etat.taches.findIndex((x) => x.id === id);
    if (i !== -1) etat.taches[i] = maj;
    rendreTaches();
  } catch (e) {
    toast(`Impossible d’enregistrer : ${e.message}`);
  }
}

/** Au passage à « fait », on propose de laisser un mot (§6.2). */
function demanderNoteDeCloture(t) {
  const zone = el('textarea', {
    name: 'note', rows: 3,
    placeholder: 'Ex : offert une carafe, envoyé le 12/07…',
  });

  const valider = async () => {
    fermerFeuille();
    await appliquer(t.id, {
      statut: 'fait',
      note_de_cloture: zone.value.trim() || null,
      termine_par: etat.membreId,
      termine_le: new Date().toISOString(),
    });
    toast('Et voilà, tadam !');
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, 'C’est fait !'),
    el('label', { class: 'champ' },
      el('span', {}, 'Un mot à laisser ? (facultatif)'), zone),
    el('button', { class: 'btn btn-secondaire', onclick: valider }, 'Valider'),
    el('button', { class: 'btn btn-discret', onclick: fermerFeuille }, 'Annuler'),
  ));
  setTimeout(() => zone.focus(), 120);
}

// ══════════════════ Création / modification ══════════════════

export function ouvrirNouvelleTache() {
  ouvrirFormulaire(null);
}

function ouvrirFormulaire(existante) {
  const t = existante || {};
  const [m1, m2] = etat.membres;
  const rec = t.recurrence || {};

  const titre = el('input', { type: 'text', value: t.titre || '', placeholder: 'Ex : Cadeau mariage Léa & Tom', maxlength: 120 });
  const description = el('textarea', { rows: 2, placeholder: 'Détail, lien, budget…' }, t.description || '');
  const echeance = el('input', { type: 'date', value: t.date_limite || '' });

  const cibleInitiale = t.id ? (t.assigne_aux_deux || !t.assigne_a ? 'deux' : t.assigne_a) : 'deux';
  const assignation = groupeOptions([
    m1 && { cle: m1.id, libelle: m1.pseudo },
    m2 && { cle: m2.id, libelle: m2.pseudo },
    { cle: 'deux', libelle: 'Les deux' },
  ].filter(Boolean), cibleInitiale);

  const categorie = groupeOptions(CATEGORIES, t.categorie || 'maison');
  const priorite = groupeOptions(PRIORITES, t.priorite || 'moyenne');

  // ── Bloc récurrence, replié tant que la case n'est pas cochée
  const frequence = groupeOptions(FREQUENCES, rec.frequence || 'mois', {
    onChange: () => majVisibiliteJour(),
  });
  const intervalle = el('input', { type: 'number', min: '1', max: '99', value: String(rec.intervalle || 1) });
  const jourDuMois = el('input', { type: 'number', min: '1', max: '31', value: rec.jour ? String(rec.jour) : '' });
  const champJour = el('label', { class: 'champ' },
    el('span', {}, 'Le jour du mois'), jourDuMois);
  const delaiNb = el('input', { type: 'number', min: '0', max: '99', value: String(rec.delai_nb || 0) });
  const delaiUnite = el('select', {},
    ...[['jour', 'jours'], ['semaine', 'semaines'], ['mois', 'mois']].map(([v, lib]) =>
      el('option', { value: v, selected: (rec.delai_unite || 'jour') === v }, lib)));

  const blocRecurrence = el('div', { class: 'masque' },
    el('p', { class: 'options-titre' }, 'Elle revient tous les…'),
    frequence,
    el('div', { class: 'champ-duo' },
      el('label', { class: 'champ' }, el('span', {}, 'Tous les (nombre)'), intervalle),
      champJour,
    ),
    el('div', { class: 'champ-duo' },
      el('label', { class: 'champ' }, el('span', {}, 'Apparaît … avant'), delaiNb),
      el('label', { class: 'champ' }, el('span', {}, 'Unité'), delaiUnite),
    ),
    el('p', { class: 'feuille-info' },
      'La carte reste cachée jusqu’à ce délai avant l’échéance. Mettre 0 pour l’afficher tout de suite.'),
  );

  const caseRecurrence = el('input', {
    type: 'checkbox', checked: !!t.recurrence,
    onchange: (e) => montrer(blocRecurrence, e.target.checked),
  });
  montrer(blocRecurrence, !!t.recurrence);
  const majVisibiliteJour = () => montrer(champJour, frequence.valeur === 'mois');
  majVisibiliteJour();

  const enregistrer = async () => {
    const nom = titre.value.trim();
    if (!nom) { toast('Il faut au moins un titre'); titre.focus(); return; }

    const recurrence = caseRecurrence.checked ? {
      serie: (t.recurrence && t.recurrence.serie) || crypto.randomUUID(),
      frequence: frequence.valeur,
      intervalle: Math.max(1, Number(intervalle.value) || 1),
      jour: frequence.valeur === 'mois' && jourDuMois.value ? Number(jourDuMois.value) : null,
      delai_nb: Number(delaiNb.value) || 0,
      delai_unite: delaiUnite.value,
    } : null;

    if (recurrence && !echeance.value) {
      toast('Une tâche récurrente a besoin d’une première échéance');
      return;
    }

    const donnees = {
      espace_id: etat.espaceId,
      titre: nom,
      description: description.value.trim() || null,
      assigne_a: assignation.valeur === 'deux' ? null : assignation.valeur,
      assigne_aux_deux: assignation.valeur === 'deux',
      categorie: categorie.valeur,
      priorite: priorite.valeur,
      date_limite: echeance.value || null,
      recurrence,
    };

    try {
      if (t.id) {
        const maj = await db.majTache(t.id, donnees);
        const i = etat.taches.findIndex((x) => x.id === t.id);
        if (i !== -1) etat.taches[i] = maj;
        toast('Tâche mise à jour');
      } else {
        const creee = await db.creerTache({ ...donnees, cree_par: etat.membreId });
        etat.taches.unshift(creee);
        toast('Tâche ajoutée');
      }
      fermerFeuille();
      rendreTaches();
    } catch (e) {
      toast(`Impossible d’enregistrer : ${e.message}`);
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, t.id ? 'Modifier la tâche' : 'Nouvelle tâche'),
    el('label', { class: 'champ' }, el('span', {}, 'Quoi ?'), titre),
    el('label', { class: 'champ' }, el('span', {}, 'Détail (facultatif)'), description),

    el('p', { class: 'options-titre' }, 'Qui s’en occupe ?'),
    assignation,
    el('p', { class: 'options-titre' }, 'Catégorie'),
    categorie,
    el('p', { class: 'options-titre' }, 'Priorité'),
    priorite,
    el('label', { class: 'champ' }, el('span', {}, 'Échéance (facultatif)'), echeance),

    el('label', { class: 'bascule' }, caseRecurrence,
      el('span', {}, 'Tâche récurrente',
        el('span', { class: 'sous' }, 'Elle réapparaîtra toute seule à chaque échéance.'))),
    blocRecurrence,

    el('button', { class: 'btn btn-primaire', onclick: enregistrer }, t.id ? 'Enregistrer' : 'Ajouter la tâche'),
    el('button', { class: 'btn btn-discret', onclick: fermerFeuille }, 'Annuler'),
  ));

  if (!t.id) setTimeout(() => titre.focus(), 120);
}
