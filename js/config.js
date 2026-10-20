// Coordonnées du projet Supabase.
//
// Ces deux valeurs sont publiques par nature : elles voyagent dans le navigateur
// de chaque utilisateur, donc n'importe qui peut les lire dans le code source de
// la page. C'est prévu — la clé « publishable » est faite pour ça.
// La clé « service_role » de Supabase, elle, ne doit JAMAIS apparaître ici.
export const SUPABASE_URL = 'https://rorswahnjnvbmabnjtlh.supabase.co';
export const SUPABASE_CLE_PUBLIQUE = 'sb_publishable_gLIfjeGROrxNEn_V36Uj1Q_Yp5bNMSm';

// Clé publique des notifications (VAPID). Publique elle aussi : le téléphone
// la présente à Apple pour dire « n'accepte que les messages signés par la
// clé privée qui va avec ». La clé privée, elle, ne vit que dans les secrets
// GitHub (VAPID_PRIVATE_KEY) — jamais dans ce dépôt.
export const VAPID_CLE_PUBLIQUE = 'BH94BRCc0Me0NAFz-E_ezu6c2cOuwrRYSAONLj02Z6MPdDVptTDeA9RSPzEtxmMkNqNhjDZbPeet9Qj7s8FAEFk';

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

// Les quatre encadrés du module Courses, dans l'ordre de la grille 2×2.
// Ces noms ne servent que de secours : la vraie valeur vit sur l'espace
// (`espaces.magasins`), renommable depuis les Réglages. Toujours quatre — la
// grille en dépend, et `NB_MAGASINS` est la seule chose à relire si un jour
// ce nombre devait changer.
export const MAGASINS_DEFAUT = ['Grand Frais', 'Monoprix', 'Pharmacie', 'Autres'];
export const NB_MAGASINS = MAGASINS_DEFAUT.length;

// Types de vêtement du guide des tailles. Une liste plutôt qu'un champ libre :
// sans elle on finit avec « T-shirt », « tshirt » et « tee-shirt » côte à côte.
// La clé est stockée en base : on peut renommer un libellé ou en ajouter un,
// mais pas changer une clé déjà utilisée.
export const TYPES_VETEMENT = [
  { cle: 'haut', libelle: 'Haut / T-shirt' },
  { cle: 'chemise', libelle: 'Chemise / Chemisier' },
  { cle: 'pull', libelle: 'Pull / Sweat' },
  { cle: 'veste', libelle: 'Veste / Manteau' },
  { cle: 'pantalon', libelle: 'Pantalon' },
  { cle: 'jean', libelle: 'Jean' },
  { cle: 'robe', libelle: 'Robe / Jupe' },
  { cle: 'short', libelle: 'Short' },
  { cle: 'lingerie', libelle: 'Lingerie / Sous-vêtements' },
  { cle: 'maillot', libelle: 'Maillot de bain' },
  { cle: 'pyjama', libelle: 'Pyjama' },
  { cle: 'chaussures', libelle: 'Chaussures' },
  { cle: 'chaussettes', libelle: 'Chaussettes / Collants' },
  { cle: 'bague', libelle: 'Bague' },
  { cle: 'ceinture', libelle: 'Ceinture' },
  { cle: 'accessoire', libelle: 'Autre accessoire' },
  { cle: 'autre', libelle: 'Autre' },
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
