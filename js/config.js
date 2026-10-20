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

// Types de vêtement du guide des tailles, avec un libellé par vestiaire :
// Damien choisit « Chemise », Dom « Chemisier ». `null` = absent de cette
// liste. Le vestiaire de chacun se règle dans ⚙ (colonne membres.vestiaire).
//
// La clé est stockée en base : on peut renommer un libellé ou ajouter une
// ligne, mais pas changer une clé déjà utilisée. L'ordre est celui de
// l'affichage, du haut du corps vers le bas.
export const TYPES_VETEMENT = [
  { cle: 'haut', homme: 'T-shirt', femme: 'Haut' },
  { cle: 'chemise', homme: 'Chemise', femme: 'Chemisier' },
  { cle: 'pull', homme: 'Pull / Sweat', femme: 'Pull / Sweat' },
  { cle: 'veste', homme: 'Veste / Manteau', femme: 'Veste / Manteau' },
  { cle: 'costume', homme: 'Costume', femme: null },
  { cle: 'robe', homme: null, femme: 'Robe' },
  { cle: 'jupe', homme: null, femme: 'Jupe' },
  { cle: 'pantalon', homme: 'Pantalon', femme: 'Pantalon' },
  { cle: 'jean', homme: 'Jean', femme: 'Jean' },
  { cle: 'short', homme: 'Short', femme: 'Short' },
  { cle: 'lingerie', homme: 'Caleçon', femme: 'Sous-vêtements' },
  { cle: 'soutien_gorge', homme: null, femme: 'Soutien-gorge' },
  { cle: 'maillot', homme: 'Maillot de bain', femme: 'Maillot de bain' },
  { cle: 'pyjama', homme: 'Pyjama', femme: 'Pyjama' },
  { cle: 'chaussures', homme: 'Chaussures', femme: 'Chaussures' },
  { cle: 'chaussettes', homme: 'Chaussettes', femme: 'Chaussettes / Collants' },
  { cle: 'bague', homme: null, femme: 'Bague' },
  { cle: 'ceinture', homme: 'Ceinture', femme: 'Ceinture' },
  { cle: 'autre', homme: 'Autre', femme: 'Autre' },
];

export const VESTIAIRES = [
  { cle: 'homme', libelle: 'Homme' },
  { cle: 'femme', libelle: 'Femme' },
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
