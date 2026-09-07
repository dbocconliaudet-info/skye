// Point d'entrée : onboarding, navigation, chargement des données, temps réel.

import {
  $, $$, el, vider, montrer, toast, ouvrirFeuille, fermerFeuille, confirmer,
  feuilleEstOuverte, formaterDate,
} from './ui.js';
import { etat, oublierSession, pseudoDe, moi, partenaire } from './etat.js';
import * as db from './db.js';
import { rendreTaches, ouvrirNouvelleTache, genererOccurrencesDues } from './taches.js';
import { rendreCourses, ajouterDepuisTexte } from './courses.js';
import { rendreTricount, ouvrirNouvelleDepense } from './tricount.js';
import {
  rendreAnniversaires, ouvrirNouvelAnniversaire, construireOngletsMois,
} from './anniversaires.js';

// ══════════════════ Onboarding ══════════════════

const BLOCS = ['#accueil-choix', '#accueil-connexion', '#accueil-oubli', '#accueil-nouveau-mdp',
  '#accueil-creation', '#accueil-code', '#accueil-rejoindre', '#accueil-sans-espace'];

/**
 * Accepte aussi bien le code seul que le lien d'invitation entier collé.
 * Indispensable une fois l'app installée sur l'écran d'accueil : elle n'a pas
 * de barre d'adresse, et sur iOS son stockage est séparé de celui de Safari —
 * la session mémorisée dans le navigateur n'y est donc pas reprise.
 */
function extraireJeton(saisie) {
  const texte = (saisie || '').trim();
  if (!texte) return '';
  const dansUrl = texte.match(/[?&]rejoindre=([^&\s]+)/);
  return (dansUrl ? dansUrl[1] : texte).replace(/\s+/g, '').toLowerCase();
}

function afficherBloc(selecteur) {
  for (const b of BLOCS) montrer($(b), b === selecteur);
  montrer($('#ecran-accueil'), true);
  montrer($('#app'), false);
}

/** Pendant une soumission : bouton grisé et libellé d'attente. */
async function pendantEnvoi(formulaire, libelle, action) {
  const bouton = formulaire.querySelector('button[type="submit"]');
  const initial = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = libelle;
  try {
    await action();
  } catch (e) {
    toast(e.message);
  } finally {
    bouton.disabled = false;
    bouton.textContent = initial;
  }
}

/** Les champs email + mot de passe n'ont de sens que si personne n'est encore
 *  connecté. Quelqu'un dont l'inscription s'est arrêtée avant le rattachement
 *  à un espace reprend là où il en était, sans recréer de compte. */
let dejaConnecte = false;

function adapterChampsCompte(formulaire) {
  const bloc = formulaire.querySelector('.champs-compte');
  if (!bloc) return;
  montrer(bloc, !dejaConnecte);
  for (const champ of bloc.querySelectorAll('input')) champ.required = !dejaConnecte;
}

/** Crée le compte si besoin, puis exécute la suite. Séparé du reste parce que
 *  les deux formulaires (créer / rejoindre) en ont exactement besoin. */
async function assurerCompte(donnees) {
  if (dejaConnecte) return;
  const email = (donnees.get('email') || '').trim();
  const motDePasse = donnees.get('motdepasse') || '';
  if (!email || !motDePasse) throw new Error('Email et mot de passe sont nécessaires');
  await db.inscrire(email, motDePasse);
  dejaConnecte = true;
}

// — Création d'un espace ————————————————————————————————————————————

function flotCreation(formulaire) {
  return pendantEnvoi(formulaire, 'Création…', async () => {
    const donnees = new FormData(formulaire);
    const nom = (donnees.get('nom') || '').trim();
    const pseudo = (donnees.get('pseudo') || '').trim();
    if (!nom || !pseudo) throw new Error('Il manque ton pseudo ou le nom de l’espace');

    await assurerCompte(donnees);
    const cree = await db.creerEspace(
      nom, pseudo, donnees.get('date_naissance'), donnees.get('date_mariage'));

    appliquerEspace(cree);
    formulaire.reset();
    await entrerDansApp();
  });
}

// — Rejoindre un espace ————————————————————————————————————————————

// Ce qu'on retient entre la saisie du code et la validation du formulaire.
const rejoindre = { jeton: '', membreId: null };

/** Charge l'aperçu de l'espace et prépare l'écran « rejoindre ». */
async function preparerRejoindre(jeton, retour = '#accueil-choix') {
  const apercu = await db.apercuEspace(jeton).catch((e) => {
    toast(`Connexion impossible : ${e.message}`);
    return undefined;
  });
  if (apercu === undefined) { afficherBloc(retour); return; }
  if (!apercu) {
    toast('Code inconnu — vérifie qu’il est complet');
    afficherBloc(retour);
    return;
  }

  rejoindre.jeton = jeton;
  rejoindre.membreId = null;
  $('#rejoindre-nom').textContent = apercu.espace_nom;

  const formulaire = $('#accueil-rejoindre');
  const champPseudo = formulaire.pseudo;
  champPseudo.value = '';

  // Membres créés avec la v1, encore sans compte : les proposer permet de
  // récupérer son historique de tâches au lieu de repartir d'une page blanche.
  const aReprendre = apercu.membres_a_reprendre || [];
  const hote = vider($('#rejoindre-membres'));
  montrer($('#rejoindre-reprise'), aReprendre.length > 0);
  for (const m of aReprendre) {
    hote.append(el('button', {
      type: 'button',
      class: 'btn btn-secondaire',
      onclick: (e) => {
        rejoindre.membreId = m.id;
        champPseudo.value = m.pseudo;
        for (const b of hote.children) b.classList.toggle('on', b === e.currentTarget);
      },
    }, `Je suis ${m.pseudo}`));
  }
  if (aReprendre.length) {
    hote.append(el('button', {
      type: 'button',
      class: 'btn btn-secondaire',
      onclick: (e) => {
        rejoindre.membreId = null;
        champPseudo.value = '';
        for (const b of hote.children) b.classList.toggle('on', b === e.currentTarget);
      },
    }, 'Aucun des deux'));
  }

  if (!aReprendre.length && apercu.places_libres === 0) {
    toast('Cet espace a déjà ses deux membres');
    afficherBloc(retour);
    return;
  }

  adapterChampsCompte(formulaire);
  afficherBloc('#accueil-rejoindre');
}

function flotRejoindre(formulaire) {
  return pendantEnvoi(formulaire, 'Un instant…', async () => {
    const donnees = new FormData(formulaire);
    const pseudo = (donnees.get('pseudo') || '').trim();
    if (!pseudo) throw new Error('Choisis ton pseudo');

    await assurerCompte(donnees);
    const rejoint = await db.rejoindreEspace(
      rejoindre.jeton, pseudo, donnees.get('date_naissance'), rejoindre.membreId);

    appliquerEspace(rejoint);
    formulaire.reset();
    await entrerDansApp();
  });
}

/** Retour commun de `creer_espace` et `rejoindre_espace`. */
function appliquerEspace({ espace_id, espace_nom, jeton, membre_id }) {
  etat.espaceId = espace_id;
  etat.espaceNom = espace_nom;
  etat.lienInvitation = jeton;
  etat.membreId = membre_id;
  // On nettoie l'URL : recharger la page ne doit pas relancer l'écran « rejoindre ».
  history.replaceState(null, '', location.pathname);
}

// — Connexion, déconnexion, mot de passe ————————————————————————————

function flotConnexion(formulaire) {
  return pendantEnvoi(formulaire, 'Connexion…', async () => {
    const donnees = new FormData(formulaire);
    await db.connecter(donnees.get('email'), donnees.get('motdepasse'));
    dejaConnecte = true;
    formulaire.reset();
    await reprendreSession();
  });
}

function flotOubli(formulaire) {
  return pendantEnvoi(formulaire, 'Envoi…', async () => {
    await db.demanderNouveauMotDePasse(new FormData(formulaire).get('email'));
    formulaire.reset();
    toast('Lien envoyé — regarde ta boîte mail');
    afficherBloc('#accueil-connexion');
  });
}

function flotNouveauMotDePasse(formulaire) {
  return pendantEnvoi(formulaire, 'Enregistrement…', async () => {
    await db.definirMotDePasse(new FormData(formulaire).get('motdepasse'));
    formulaire.reset();
    history.replaceState(null, '', location.pathname);
    toast('Mot de passe enregistré');
    await reprendreSession();
  });
}

async function seDeconnecter() {
  if (desabonner) { desabonner(); desabonner = null; }
  await db.deconnecter();
  dejaConnecte = false;
  oublierSession();
  afficherBloc('#accueil-choix');
}

/** Une fois connecté : soit le compte a un espace et on entre, soit il n'en a
 *  pas encore et on propose d'en créer ou d'en rejoindre un. */
async function reprendreSession() {
  const membre = await db.monMembre();
  if (!membre) {
    if (rejoindre.jeton) { await preparerRejoindre(rejoindre.jeton, '#accueil-sans-espace'); return; }
    afficherBloc('#accueil-sans-espace');
    return;
  }
  const espace = await db.espaceParId(membre.espace_id);
  etat.espaceId = membre.espace_id;
  etat.membreId = membre.id;
  etat.espaceNom = espace?.nom || '';
  etat.lienInvitation = espace?.lien_invitation || '';
  await entrerDansApp();
}

// ══════════════════ Chargement et rendu ══════════════════

let desabonner = null;

async function entrerDansApp() {
  montrer($('#ecran-accueil'), false);
  montrer($('#app'), true);
  basculerModule(etat.module);

  try {
    await rechargerDonnees();
    const creees = await genererOccurrencesDues();
    if (creees) rendreTaches();
  } catch (e) {
    toast(`Chargement incomplet : ${e.message}`);
  }

  if (desabonner) desabonner();
  desabonner = db.abonner(etat.espaceId, planifierRechargement);

  // Après le board, pas avant : un mot doux sur un écran encore vide tomberait
  // à plat, et on a besoin des pseudos chargés pour nommer son auteur.
  afficherMotsRecus();
}

async function rechargerDonnees() {
  const [espace, membres, taches, listes, articles, depenses, anniversaires, dico] =
    await Promise.all([
      db.espaceParId(etat.espaceId),
      db.chargerMembres(etat.espaceId),
      db.chargerTaches(etat.espaceId),
      db.chargerListes(etat.espaceId),
      db.chargerArticles(etat.espaceId),
      db.chargerDepenses(etat.espaceId),
      db.chargerAnniversaires(etat.espaceId),
      db.chargerDico(etat.espaceId),
    ]);
  // Relire l'espace à chaque fois évite de traîner un nom ou une date modifiés
  // depuis l'autre téléphone : ces trois champs ne passent pas par le temps réel.
  if (espace) {
    etat.espaceNom = espace.nom;
    etat.lienInvitation = espace.lien_invitation;
    etat.dateMariage = espace.date_mariage_pacs || '';
  }
  etat.membres = membres;
  etat.taches = taches;
  etat.listes = listes;
  etat.articles = articles;
  etat.depenses = depenses;
  etat.anniversaires = anniversaires;
  etat.dico = new Map(dico.map((d) => [d.mot, d.rayon]));
  rendreTout();
}

function rendreTout() {
  rendreTaches();
  rendreCourses();
  rendreTricount();
  rendreAnniversaires();
}

/**
 * Le temps réel déclenche un rechargement complet plutôt qu'une fusion
 * ligne à ligne. Sur un espace à deux personnes, les données tiennent en
 * quelques dizaines de lignes : recharger coûte moins cher qu'une logique
 * de fusion, et surtout ça ne peut pas désynchroniser silencieusement
 * l'écran de la base.
 */
let minuteurRechargement;
function planifierRechargement() {
  clearTimeout(minuteurRechargement);
  minuteurRechargement = setTimeout(() => {
    rechargerDonnees().catch(() => { /* réseau instable : on retentera au prochain événement */ });
  }, 300);
}

// ══════════════════ Navigation ══════════════════

const TITRES_MODULES = {
  taches: 'On s’en occupe',
  courses: 'Courses',
  tricount: 'Tricount',
  anniversaires: 'Anniversaires',
};

function basculerModule(nom) {
  etat.module = nom;
  montrer($('#vue-taches'), nom === 'taches');
  montrer($('#vue-courses'), nom === 'courses');
  montrer($('#vue-tricount'), nom === 'tricount');
  montrer($('#vue-anniversaires'), nom === 'anniversaires');
  $('#titre-module').textContent = TITRES_MODULES[nom] || '';
  for (const b of $$('.tabbar button')) b.classList.toggle('on', b.dataset.module === nom);
}

function brancherEvenements() {
  // — Onboarding
  for (const b of $$('[data-action="ouvrir-creation"]')) {
    b.addEventListener('click', () => {
      adapterChampsCompte($('#accueil-creation'));
      afficherBloc('#accueil-creation');
    });
  }
  for (const b of $$('[data-action="ouvrir-code"]')) {
    b.addEventListener('click', () => afficherBloc('#accueil-code'));
  }
  for (const b of $$('[data-action="ouvrir-connexion"]')) {
    b.addEventListener('click', () => afficherBloc('#accueil-connexion'));
  }
  $('[data-action="ouvrir-oubli"]').addEventListener('click', () => afficherBloc('#accueil-oubli'));
  $('[data-action="deconnexion"]').addEventListener('click', seDeconnecter);
  for (const b of $$('[data-action="retour-accueil"]')) {
    b.addEventListener('click', () => afficherBloc(dejaConnecte ? '#accueil-sans-espace' : '#accueil-choix'));
  }

  const surSoumission = (selecteur, gestionnaire) => {
    $(selecteur).addEventListener('submit', (e) => {
      e.preventDefault();
      gestionnaire(e.currentTarget);
    });
  };
  surSoumission('#accueil-connexion', flotConnexion);
  surSoumission('#accueil-oubli', flotOubli);
  surSoumission('#accueil-nouveau-mdp', flotNouveauMotDePasse);
  surSoumission('#accueil-creation', flotCreation);
  surSoumission('#accueil-rejoindre', flotRejoindre);
  surSoumission('#accueil-code', (formulaire) => {
    const jeton = extraireJeton(formulaire.code.value);
    if (!jeton) { toast('Entre le code de l’espace'); return; }
    preparerRejoindre(jeton, '#accueil-code');
  });

  // — Barre d'onglets
  for (const b of $$('.tabbar button')) {
    b.addEventListener('click', () => basculerModule(b.dataset.module));
  }

  // — Tâches : onglets et filtres
  for (const b of $$('[data-onglet-taches]')) {
    b.addEventListener('click', () => {
      etat.ongletTaches = b.dataset.ongletTaches;
      for (const autre of $$('[data-onglet-taches]')) autre.classList.toggle('on', autre === b);
      rendreTaches();
    });
  }
  for (const b of $$('[data-groupement]')) {
    b.addEventListener('click', () => {
      etat.groupement = b.dataset.groupement;
      for (const autre of $$('[data-groupement]')) autre.classList.toggle('on', autre === b);
      rendreTaches();
    });
  }
  for (const b of $$('[data-filtre-histo]')) {
    b.addEventListener('click', () => {
      etat.filtreHisto = b.dataset.filtreHisto;
      for (const autre of $$('[data-filtre-histo]')) autre.classList.toggle('on', autre === b);
      rendreTaches();
    });
  }
  $('[data-action="nouvelle-tache"]').addEventListener('click', ouvrirNouvelleTache);

  // — Tricount
  $('[data-action="nouvelle-depense"]').addEventListener('click', ouvrirNouvelleDepense);

  // — Anniversaires
  construireOngletsMois();
  $('[data-action="nouvel-anniversaire"]').addEventListener('click', ouvrirNouvelAnniversaire);

  // — Courses : barre d'ajout
  $('#barre-ajout').addEventListener('submit', (e) => {
    e.preventDefault();
    const champ = e.currentTarget.article;
    const texte = champ.value;
    champ.value = '';
    ajouterDepuisTexte(texte);
  });

  // — Réglages
  $('[data-action="ouvrir-reglages"]').addEventListener('click', ouvrirReglages);

  // — Feuille modale : clic sur le voile, touche Échap
  $('#voile').addEventListener('click', (e) => { if (e.target.id === 'voile') fermerFeuille(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && feuilleEstOuverte()) fermerFeuille(); });

  // — Retour dans l'app après un passage en arrière-plan : on resynchronise.
  //   Sur un téléphone, l'app n'est presque jamais fermée pour de bon : c'est
  //   ce retour-là, et pas le démarrage à froid, qui fait office d'« ouverture »
  //   pour les mots du/de la partenaire.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !etat.espaceId) return;
    planifierRechargement();
    afficherMotsRecus();
  });
}

// ══════════════════ Réglages ══════════════════

function lienInvitation() {
  return `${location.origin}${location.pathname}?rejoindre=${etat.lienInvitation}`;
}

async function partagerLien() {
  const lien = lienInvitation();
  const texte = `Rejoins notre espace Skye « ${etat.espaceNom} » : ${lien}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Skye', text: texte, url: lien }); return; }
    await navigator.clipboard.writeText(lien);
    toast('Lien copié');
  } catch {
    // Partage annulé, ou presse-papiers refusé (page non sécurisée) : on affiche
    // le lien pour qu'il reste sélectionnable à la main.
    ouvrirFeuille(el('div', {},
      el('h2', {}, 'Lien d’invitation'),
      el('label', { class: 'champ' },
        el('span', {}, 'À copier et envoyer par SMS'),
        el('input', { type: 'text', value: lien, readonly: true, onclick: (e) => e.target.select() })),
      el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Fermer'),
    ));
  }
}

// ══════════════════ Mot au/à la partenaire ══════════════════

/** Affiche les mots non lus, un par un, à l'ouverture de l'app (§4 des
 *  évolutions). Rien n'est montré si une feuille est déjà ouverte : un mot doux
 *  qui recouvre une tâche en cours de saisie raterait complètement son effet. */
async function afficherMotsRecus() {
  if (!etat.espaceId || !etat.membreId || feuilleEstOuverte()) return;
  let mots;
  try {
    mots = await db.messagesPourMoi(etat.espaceId, etat.membreId);
  } catch {
    return;   // réseau capricieux : le mot attendra la prochaine ouverture
  }
  for (const mot of mots) await montrerMot(mot);
}

/** Résout une fois le mot fermé et marqué lu. Si le marquage échoue, le mot
 *  reste non lu et réapparaîtra — mieux vaut le revoir que le perdre. */
function montrerMot(mot) {
  return new Promise((resolve) => {
    let traite = false;
    const auFermer = async () => {
      if (traite) return;
      traite = true;
      await db.marquerMessageLu(mot.id).catch(() => { /* il reviendra */ });
      resolve();
    };
    ouvrirFeuille(el('div', { class: 'mot' },
      el('p', { class: 'mot-de' }, `Un mot de ${pseudoDe(mot.auteur_membre_id) || 'ton/ta partenaire'}`),
      el('p', { class: 'mot-contenu' }, mot.contenu),
      el('button', { class: 'btn btn-primaire', onclick: fermerFeuille }, 'Merci ♥'),
    ), { auFermer });
  });
}

function ouvrirEcritureMot() {
  const autre = partenaire();
  if (!autre) { toast('Personne n’a encore rejoint ton espace'); return; }

  const champ = el('textarea', { rows: 4, maxlength: 500, placeholder: 'Ton petit mot…' });

  const envoyer = async (e) => {
    const contenu = champ.value.trim();
    if (!contenu) { toast('Le mot est vide'); return; }
    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Envoi…';
    try {
      await db.envoyerMessage(etat.espaceId, etat.membreId, autre.id, contenu);
      fermerFeuille();
      toast(`Ton mot attend ${autre.pseudo}`);
    } catch (err) {
      toast(`Envoi impossible : ${err.message}`);
      bouton.disabled = false;
      bouton.textContent = 'Envoyer';
    }
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, `Un mot pour ${autre.pseudo}`),
    el('p', { class: 'feuille-info' },
      `Il s’affichera à sa prochaine ouverture de l’app, une seule fois. `
      + `Ni toi ni ${autre.pseudo} ne pourrez le relire ensuite — c’est fait pour.`),
    el('label', { class: 'champ' }, el('span', {}, 'Ton message'), champ),
    el('button', { class: 'btn btn-primaire', onclick: envoyer }, 'Envoyer'),
    el('button', { class: 'btn btn-fantome', onclick: fermerFeuille }, 'Annuler'),
  ));
}

// ══════════════════ Réglages ══════════════════

/** Section « Nos dates » des réglages (§2 des évolutions). La date de naissance
 *  de l'autre s'affiche sans être modifiable : la base refuse d'ailleurs qu'on
 *  touche la ligne de quelqu'un d'autre, autant que l'écran le dise. */
function sectionDates() {
  const moiMeme = moi();
  const autre = partenaire();

  const champNaissance = el('input', { type: 'date', value: moiMeme?.date_naissance || '' });
  const champMariage = el('input', { type: 'date', value: etat.dateMariage || '' });

  const enregistrer = async (e) => {
    const bouton = e.currentTarget;
    bouton.disabled = true;
    bouton.textContent = 'Enregistrement…';
    try {
      await Promise.all([
        db.majMembre(etat.membreId, { date_naissance: champNaissance.value || null }),
        db.majEspace(etat.espaceId, { date_mariage_pacs: champMariage.value || null }),
      ]);
      await rechargerDonnees();
      fermerFeuille();
      toast('Dates enregistrées');
    } catch (err) {
      toast(`Enregistrement impossible : ${err.message}`);
      bouton.disabled = false;
      bouton.textContent = 'Enregistrer les dates';
    }
  };

  return el('div', {},
    el('h3', { class: 'feuille-titre' }, 'Nos dates'),
    el('label', { class: 'champ' }, el('span', {}, 'Ta date de naissance'), champNaissance),
    autre?.date_naissance
      ? el('p', { class: 'feuille-info' },
        `Date de naissance de ${autre.pseudo} : ${formaterDate(autre.date_naissance)}.`)
      : null,
    el('label', { class: 'champ' },
      el('span', {}, 'Votre date de mariage ou de PACS'), champMariage),
    el('button', { class: 'btn btn-secondaire', onclick: enregistrer }, 'Enregistrer les dates'),
  );
}

function ouvrirReglages() {
  const quitter = async () => {
    fermerFeuille();
    const oui = await confirmer('Se déconnecter de cet appareil ?', {
      detail: 'Les données restent en ligne. Il faudra ton email et ton mot de passe pour revenir.',
      texteOk: 'Se déconnecter', danger: true,
    });
    if (!oui) return;
    await seDeconnecter();
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, etat.espaceNom || 'Notre espace'),
    el('p', { class: 'recap' },
      el('strong', {}, 'Connecté·e en tant que : '), pseudoDe(etat.membreId) || '—', el('br'),
      el('strong', {}, 'Membres : '), etat.membres.map((m) => m.pseudo).join(' et ')),

    el('button', { class: 'btn btn-primaire', onclick: partagerLien }, 'Envoyer le lien d’invitation'),
    partenaire()
      ? el('button', { class: 'btn btn-secondaire', onclick: ouvrirEcritureMot },
        `Écrire un mot à ${partenaire().pseudo}`)
      : null,

    el('div', { class: 'separateur' }),
    sectionDates(),

    el('div', { class: 'separateur' }),
    el('label', { class: 'champ' },
      el('span', {}, 'Code de l’espace'),
      el('input', {
        type: 'text', value: etat.lienInvitation, readonly: true,
        onclick: (e) => { e.target.select(); },
      })),
    el('p', { class: 'feuille-info' },
      'À saisir dans « J’ai déjà un espace » pour rentrer depuis un autre appareil, '
      + 'ou après avoir installé l’app sur l’écran d’accueil — sur iPhone, l’app installée '
      + 'a sa propre mémoire, séparée de celle de Safari.'),

    el('div', { class: 'separateur' }),
    el('p', { class: 'feuille-info' },
      'Astuce : sur iPhone, « Partager » puis « Sur l’écran d’accueil » installe Skye comme une vraie application.'),
    el('button', { class: 'btn btn-destructif', onclick: quitter }, 'Se déconnecter'),
  ));
}

// ══════════════════ Service worker ══════════════════

function installerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne : sans conséquence */ });
  });

  // Quand une nouvelle version prend la main, on recharge une fois pour
  // éviter de mélanger l'ancien HTML avec les nouveaux modules JS.
  let dejaRecharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (dejaRecharge) return;
    dejaRecharge = true;
    location.reload();
  });
}

// ══════════════════ Démarrage ══════════════════

async function demarrer() {
  brancherEvenements();
  installerServiceWorker();

  // Le lien « mot de passe oublié » ramène ici avec un jeton de récupération
  // dans l'adresse. Supabase l'échange contre une session et prévient par cet
  // événement : c'est le seul moment où on affiche l'écran de nouveau mot de
  // passe, sinon la personne se retrouverait dans l'app sans l'avoir choisi.
  let recuperation = /type=recovery/.test(location.hash);
  db.sb.auth.onAuthStateChange((evenement) => {
    if (evenement !== 'PASSWORD_RECOVERY') return;
    recuperation = true;
    dejaConnecte = true;
    afficherBloc('#accueil-nouveau-mdp');
  });

  // Mémorisé avant tout : la personne invitée doit atterrir sur le bon espace,
  // qu'elle ait déjà un compte ou qu'elle vienne de le créer.
  rejoindre.jeton = extraireJeton(new URLSearchParams(location.search).get('rejoindre'));

  try {
    const session = await db.sessionCourante();
    dejaConnecte = Boolean(session);
    if (recuperation) { afficherBloc('#accueil-nouveau-mdp'); return; }
    if (session) { await reprendreSession(); return; }
  } catch (e) {
    toast(`Connexion impossible : ${e.message}`);
  }

  if (rejoindre.jeton) { await preparerRejoindre(rejoindre.jeton); return; }
  afficherBloc('#accueil-choix');
}

demarrer();
