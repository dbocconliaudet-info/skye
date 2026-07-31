// État de l'application + ce qui est mémorisé sur l'appareil.
//
// Le brief prévoit une identification légère : on retient l'espace et le membre
// choisi dans le localStorage du téléphone, sans mot de passe.

const CLE_STOCKAGE = 'todomtadam.session';

export const etat = {
  // Session (persistée)
  espaceId: null,
  espaceNom: '',
  lienInvitation: '',
  membreId: null,

  // Données chargées depuis Supabase
  membres: [],
  taches: [],
  listes: [],
  articles: [],
  dico: new Map(),          // mot normalisé -> rayon appris par le couple

  // Navigation
  module: 'taches',          // 'taches' | 'courses'
  ongletTaches: 'actives',   // 'actives' | 'historique'
  filtreHisto: 'tout',       // 'tout' | 'fait' | 'sans_objet'
  listeActiveId: null,
};

export function chargerSession() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return false;
    const s = JSON.parse(brut);
    if (!s.espaceId || !s.membreId) return false;
    Object.assign(etat, {
      espaceId: s.espaceId,
      espaceNom: s.espaceNom || '',
      lienInvitation: s.lienInvitation || '',
      membreId: s.membreId,
    });
    return true;
  } catch {
    return false;   // stockage corrompu ou désactivé : on repart de l'accueil
  }
}

export function enregistrerSession() {
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify({
      espaceId: etat.espaceId,
      espaceNom: etat.espaceNom,
      lienInvitation: etat.lienInvitation,
      membreId: etat.membreId,
    }));
  } catch {
    // Mode navigation privée : l'app reste utilisable, simplement il faudra
    // rechoisir son prénom à la prochaine ouverture.
  }
}

export function effacerSession() {
  try { localStorage.removeItem(CLE_STOCKAGE); } catch { /* sans conséquence */ }
  Object.assign(etat, {
    espaceId: null, espaceNom: '', lienInvitation: '', membreId: null,
    membres: [], taches: [], listes: [], articles: [], dico: new Map(),
    listeActiveId: null,
  });
}

export const membreParId = (id) => etat.membres.find((m) => m.id === id) || null;
export const prenomDe = (id) => (membreParId(id) || {}).prenom || '';
export const moi = () => membreParId(etat.membreId);

export const listeParId = (id) => etat.listes.find((l) => l.id === id) || null;
export const listePermanente = () => etat.listes.find((l) => l.type === 'permanente') || null;
