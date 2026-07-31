// Point d'entrée : onboarding, navigation, chargement des données, temps réel.

import { $, $$, el, vider, montrer, toast, ouvrirFeuille, fermerFeuille, confirmer, feuilleEstOuverte } from './ui.js';
import { etat, chargerSession, enregistrerSession, effacerSession, prenomDe } from './etat.js';
import * as db from './db.js';
import { rendreTaches, ouvrirNouvelleTache, genererOccurrencesDues } from './taches.js';
import { rendreCourses, ajouterDepuisTexte } from './courses.js';

// ══════════════════ Onboarding ══════════════════

const BLOCS = ['#accueil-choix', '#accueil-creation', '#accueil-rejoindre', '#accueil-identite'];

function afficherBloc(selecteur) {
  for (const b of BLOCS) montrer($(b), b === selecteur);
  montrer($('#ecran-accueil'), true);
  montrer($('#app'), false);
}

function boutonsMembres(hote, auChoix) {
  vider(hote);
  for (const m of etat.membres) {
    hote.append(el('button', {
      class: 'btn btn-doux',
      onclick: () => auChoix(m),
    }, m.prenom));
  }
}

async function flotCreation(formulaire) {
  const donnees = new FormData(formulaire);
  const nom = (donnees.get('nom') || '').trim();
  const p1 = (donnees.get('membre1') || '').trim();
  const p2 = (donnees.get('membre2') || '').trim();
  if (!nom || !p1 || !p2) { toast('Il manque un champ'); return; }

  const bouton = formulaire.querySelector('button[type="submit"]');
  bouton.disabled = true;
  bouton.textContent = 'Création…';

  try {
    const { espace, membres } = await db.creerEspace(nom, p1, p2);
    etat.espaceId = espace.id;
    etat.espaceNom = espace.nom;
    etat.lienInvitation = espace.lien_invitation;
    etat.membres = membres;

    boutonsMembres($('#identite-membres'), choisirIdentite);
    afficherBloc('#accueil-identite');
  } catch (e) {
    toast(`Création impossible : ${e.message}`);
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Créer l’espace';
  }
}

async function flotRejoindre(jeton) {
  try {
    const espace = await db.espaceParJeton(jeton);
    if (!espace) {
      toast('Ce lien d’invitation n’est plus valide');
      afficherBloc('#accueil-choix');
      return;
    }
    etat.espaceId = espace.id;
    etat.espaceNom = espace.nom;
    etat.lienInvitation = espace.lien_invitation;
    etat.membres = await db.chargerMembres(espace.id);

    $('#rejoindre-nom').textContent = espace.nom;
    boutonsMembres($('#rejoindre-membres'), choisirIdentite);
    afficherBloc('#accueil-rejoindre');
  } catch (e) {
    toast(`Connexion impossible : ${e.message}`);
    afficherBloc('#accueil-choix');
  }
}

async function choisirIdentite(membre) {
  etat.membreId = membre.id;
  enregistrerSession();
  // On nettoie l'URL : recharger la page ne doit pas relancer l'écran « rejoindre ».
  history.replaceState(null, '', location.pathname);
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
}

async function rechargerDonnees() {
  const [membres, taches, listes, articles, dico] = await Promise.all([
    db.chargerMembres(etat.espaceId),
    db.chargerTaches(etat.espaceId),
    db.chargerListes(etat.espaceId),
    db.chargerArticles(etat.espaceId),
    db.chargerDico(etat.espaceId),
  ]);
  etat.membres = membres;
  etat.taches = taches;
  etat.listes = listes;
  etat.articles = articles;
  etat.dico = new Map(dico.map((d) => [d.mot, d.rayon]));
  rendreTout();
}

function rendreTout() {
  rendreTaches();
  rendreCourses();
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

function basculerModule(nom) {
  etat.module = nom;
  montrer($('#vue-taches'), nom === 'taches');
  montrer($('#vue-courses'), nom === 'courses');
  $('#titre-module').textContent = nom === 'taches' ? 'On s’en occupe' : 'Courses';
  for (const b of $$('.tabbar button')) b.classList.toggle('on', b.dataset.module === nom);
}

function brancherEvenements() {
  // — Onboarding
  $('[data-action="ouvrir-creation"]').addEventListener('click', () => afficherBloc('#accueil-creation'));
  for (const b of $$('[data-action="retour-accueil"]')) {
    b.addEventListener('click', () => afficherBloc('#accueil-choix'));
  }
  $('#accueil-creation').addEventListener('submit', (e) => {
    e.preventDefault();
    flotCreation(e.currentTarget);
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
  for (const b of $$('[data-filtre-histo]')) {
    b.addEventListener('click', () => {
      etat.filtreHisto = b.dataset.filtreHisto;
      for (const autre of $$('[data-filtre-histo]')) autre.classList.toggle('on', autre === b);
      rendreTaches();
    });
  }
  $('[data-action="nouvelle-tache"]').addEventListener('click', ouvrirNouvelleTache);

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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && etat.espaceId) planifierRechargement();
  });
}

// ══════════════════ Réglages ══════════════════

function lienInvitation() {
  return `${location.origin}${location.pathname}?rejoindre=${etat.lienInvitation}`;
}

async function partagerLien() {
  const lien = lienInvitation();
  const texte = `Rejoins notre espace ToDomTaDam « ${etat.espaceNom} » : ${lien}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'ToDomTaDam', text: texte, url: lien }); return; }
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
      el('button', { class: 'btn btn-discret', onclick: fermerFeuille }, 'Fermer'),
    ));
  }
}

function ouvrirReglages() {
  const changerIdentite = () => {
    const hote = el('div', { class: 'choix-membres' });
    for (const m of etat.membres) {
      hote.append(el('button', {
        class: `btn ${m.id === etat.membreId ? 'btn-primaire' : 'btn-doux'}`,
        onclick: () => {
          etat.membreId = m.id;
          enregistrerSession();
          fermerFeuille();
          rendreTout();
          toast(`Bonjour ${m.prenom} !`);
        },
      }, m.prenom));
    }
    ouvrirFeuille(el('div', {}, el('h2', {}, 'Qui es-tu ?'), hote,
      el('button', { class: 'btn btn-discret', onclick: fermerFeuille }, 'Annuler')));
  };

  const quitter = async () => {
    fermerFeuille();
    const oui = await confirmer('Se déconnecter de cet appareil ?', {
      detail: 'Les données restent en ligne. Il faudra le lien d’invitation pour revenir.',
      texteOk: 'Se déconnecter', danger: true,
    });
    if (!oui) return;
    if (desabonner) { desabonner(); desabonner = null; }
    effacerSession();
    afficherBloc('#accueil-choix');
  };

  ouvrirFeuille(el('div', {},
    el('h2', {}, etat.espaceNom || 'Notre espace'),
    el('p', { class: 'recap' },
      el('strong', {}, 'Connecté·e en tant que : '), prenomDe(etat.membreId) || '—', el('br'),
      el('strong', {}, 'Membres : '), etat.membres.map((m) => m.prenom).join(' et ')),

    el('button', { class: 'btn btn-primaire', onclick: partagerLien }, 'Envoyer le lien d’invitation'),
    el('button', { class: 'btn btn-doux', onclick: changerIdentite }, 'Changer de personne'),

    el('div', { class: 'separateur' }),
    el('p', { class: 'feuille-info' },
      'Astuce : sur iPhone, « Partager » puis « Sur l’écran d’accueil » installe ToDomTaDam comme une vraie application.'),
    el('button', { class: 'btn btn-danger', onclick: quitter }, 'Se déconnecter'),
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

  const jeton = new URLSearchParams(location.search).get('rejoindre');
  if (jeton) { await flotRejoindre(jeton); return; }

  if (chargerSession()) {
    await entrerDansApp();
    // Le nom de l'espace peut avoir changé, ou n'avoir jamais été mémorisé.
    if (!etat.lienInvitation || !etat.espaceNom) {
      const espace = await db.espaceParId(etat.espaceId).catch(() => null);
      if (espace) {
        etat.espaceNom = espace.nom;
        etat.lienInvitation = espace.lien_invitation;
        enregistrerSession();
      }
    }
    return;
  }

  afficherBloc('#accueil-choix');
}

demarrer();
