// Coordonnées du projet Supabase.
//
// Ces deux valeurs sont publiques par nature : elles voyagent dans le navigateur
// de chaque utilisateur, donc n'importe qui peut les lire dans le code source de
// la page. C'est prévu — la clé « publishable » est faite pour ça.
// La clé « service_role » de Supabase, elle, ne doit JAMAIS apparaître ici.
export const SUPABASE_URL = 'https://rorswahnjnvbmabnjtlh.supabase.co';
export const SUPABASE_CLE_PUBLIQUE = 'sb_publishable_gLIfjeGROrxNEn_V36Uj1Q_Yp5bNMSm';

// Catégories de tâches (§6.1 du cahier des charges).
// La clé est stockée en base, le libellé est affiché.
export const CATEGORIES = [
  { cle: 'admin', libelle: 'Admin / Paperasse' },
  { cle: 'maison', libelle: 'Maison' },
  { cle: 'famille', libelle: 'Famille' },
  { cle: 'amis', libelle: 'Amis' },
  { cle: 'cadeaux', libelle: 'Cadeaux & Événements' },
  { cle: 'vacances', libelle: 'Vacances' },
  { cle: 'sport', libelle: 'Sport' },
  { cle: 'loisirs', libelle: 'Loisirs' },
  { cle: 'sante', libelle: 'Santé' },
];

export const PRIORITES = [
  { cle: 'basse', libelle: 'Basse' },
  { cle: 'moyenne', libelle: 'Moyenne' },
  { cle: 'haute', libelle: 'Haute' },
];

export const STATUTS = [
  { cle: 'a_faire', libelle: 'À faire' },
  { cle: 'en_cours', libelle: 'En cours' },
  { cle: 'fait', libelle: 'Fait' },
];

export const FREQUENCES = [
  { cle: 'jour', libelle: 'Jour' },
  { cle: 'semaine', libelle: 'Semaine' },
  { cle: 'mois', libelle: 'Mois' },
  { cle: 'annee', libelle: 'Année' },
];

export const libelleDe = (liste, cle) =>
  (liste.find((x) => x.cle === cle) || {}).libelle || cle;
