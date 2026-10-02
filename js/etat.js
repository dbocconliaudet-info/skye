// État de l'application.
//
// Depuis la v2, l'identité ne vit plus dans le localStorage de l'app : c'est
// Supabase Auth qui garde la session sur l'appareil et la renouvelle seul.
// L'espace et le membre sont relus depuis la base à chaque démarrage — une
// seule source de vérité, donc plus de risque qu'un appareil garde en mémoire
// un membre qui n'existe plus.

export const etat = {
  // Session (relue au démarrage depuis Supabase)
  espaceId: null,
  espaceNom: '',
  lienInvitation: '',
  dateMariage: '',
  dernierMomentADeux: '',   // horodatage ; le compteur de l'accueil en découle
  magasins: [],             // les quatre enseignes, dans l'ordre des encadrés
  membreId: null,

  // Données chargées depuis Supabase
  membres: [],
  taches: [],
  listes: [],
  articles: [],
  depenses: [],
  anniversaires: [],
  personnels: [],
  personnelsTaux: [],
  personnelsHeures: [],     // 24 derniers mois seulement (voir db.chargerHeures)
  personnelsPaiements: [],

  // Navigation
  // 'accueil' | 'taches' | 'courses' | 'tricount' | 'anniversaires'
  module: 'accueil',
  ongletTaches: 'actives',   // 'actives' | 'historique'
  filtreHisto: 'tout',       // 'tout' | 'fait' | 'sans_objet'
  groupement: 'personne',    // 'personne' | 'categorie' | 'priorite'
  vueAnniversaires: 'a_venir', // 'a_venir' | 1..12
  listeActiveId: null,
  // Index du magasin ouvert en pleine page, ou null quand on est sur la grille
  // des quatre encadrés. Sous-navigation interne au module Courses : c'est elle
  // qui décide où ramène la flèche de retour.
  magasinOuvert: null,

  // Même principe dans « Home team » : la personne ouverte, ou null pour la
  // liste. `lundiAffiche` est la date ISO du lundi de la semaine à l'écran.
  personnelOuvert: null,
  ongletPersonnel: 'calendrier',   // 'calendrier' | 'synthese' | 'export'
  lundiAffiche: '',
  moisExport: '',                  // 'AAAA-MM' du relevé à envoyer
};

/** Remet l'état à zéro à la déconnexion, sans toucher aux préférences d'affichage. */
export function oublierSession() {
  Object.assign(etat, {
    espaceId: null, espaceNom: '', lienInvitation: '', dateMariage: '',
    dernierMomentADeux: '', magasins: [], membreId: null,
    membres: [], taches: [], listes: [], articles: [], depenses: [], anniversaires: [],
    personnels: [], personnelsTaux: [], personnelsHeures: [], personnelsPaiements: [],
    listeActiveId: null, magasinOuvert: null, personnelOuvert: null,
    lundiAffiche: '', moisExport: '',
  });
}

export const membreParId = (id) => etat.membres.find((m) => m.id === id) || null;
export const pseudoDe = (id) => (membreParId(id) || {}).pseudo || '';
export const moi = () => membreParId(etat.membreId);
/** L'autre membre de l'espace, ou null tant qu'il n'a pas rejoint. */
export const partenaire = () => etat.membres.find((m) => m.id !== etat.membreId) || null;

export const personnelParId = (id) => etat.personnels.find((p) => p.id === id) || null;

export const listeParId = (id) => etat.listes.find((l) => l.id === id) || null;
export const listePermanente = () => etat.listes.find((l) => l.type === 'permanente') || null;
