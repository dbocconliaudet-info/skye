// Petites briques d'interface partagées par tous les modules.

export const $ = (sel, racine = document) => racine.querySelector(sel);
export const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];

/** Construit un élément DOM. Le texte passe toujours par des nœuds texte,
 *  donc rien de ce que Damien ou Dom saisit ne peut être interprété en HTML. */
export function el(balise, props = {}, ...enfants) {
  const n = document.createElement(balise);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const enfant of enfants.flat(4)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    n.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return n;
}

export function vider(noeud) {
  while (noeud.firstChild) noeud.removeChild(noeud.firstChild);
  return noeud;
}

export function montrer(noeud, visible = true) {
  noeud.classList.toggle('masque', !visible);
}

// ── Toast ──────────────────────────────────────────────────────────────────

let minuteurToast;
export function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('visible');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => t.classList.remove('visible'), 2600);
}

// ── Feuille modale ─────────────────────────────────────────────────────────

let fermetureEnCours = null;

/** Ouvre la feuille du bas. `contenu` est un DocumentFragment ou un élément. */
export function ouvrirFeuille(contenu, { auFermer } = {}) {
  const voile = $('#voile');
  const feuille = $('#feuille');
  vider(feuille).append(contenu);
  montrer(voile, true);
  fermetureEnCours = auFermer || null;
  feuille.scrollTop = 0;
  return feuille;
}

export function fermerFeuille() {
  montrer($('#voile'), false);
  vider($('#feuille'));
  const cb = fermetureEnCours;
  fermetureEnCours = null;
  if (cb) cb();
}

export function feuilleEstOuverte() {
  return !$('#voile').classList.contains('masque');
}

/** Confirmation en feuille modale (window.confirm est bloqué dans certaines PWA iOS). */
export function confirmer(titre, { detail, texteOk = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let repondu = false;
    const repondre = (v) => {
      if (repondu) return;
      repondu = true;
      fermerFeuille();
      resolve(v);
    };
    ouvrirFeuille(
      el('div', {},
        el('h2', {}, titre),
        detail ? el('p', { class: 'feuille-info' }, detail) : null,
        // Le rouge de marque est la couleur d'action, jamais celle du danger :
        // une confirmation destructive porte `--danger`, plus une icône et un
        // libellé explicite — la couleur ne doit jamais suffire à alerter.
        el('button', {
          class: danger ? 'btn btn-destructif' : 'btn btn-primaire',
          onclick: () => repondre(true),
        }, texteOk),
        el('button', { class: 'btn btn-fantome', onclick: () => repondre(false) }, 'Annuler'),
      ),
      { auFermer: () => repondre(false) },
    );
  });
}

/** Groupe de boutons à choix unique. Renvoie l'élément ; la valeur se lit via `.valeur`. */
export function groupeOptions(items, valeurInitiale, { vert = false, onChange } = {}) {
  const boite = el('div', { class: vert ? 'options options-vert' : 'options' });
  boite.valeur = valeurInitiale;
  for (const item of items) {
    const b = el('button', {
      type: 'button',
      class: item.cle === valeurInitiale ? 'on' : '',
      onclick: () => {
        boite.valeur = item.cle;
        [...boite.children].forEach((c) => c.classList.toggle('on', c === b));
        if (onChange) onChange(item.cle);
      },
    }, item.libelle);
    boite.append(b);
  }
  return boite;
}

// ── Dates ──────────────────────────────────────────────────────────────────

/** Date du jour au format 'AAAA-MM-JJ', en heure locale (pas UTC : un ajout à
 *  23h le soir ne doit pas être daté du lendemain). */
export function aujourdhui() {
  return versIso(new Date());
}

export function versIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'AAAA-MM-JJ' → objet Date local (new Date('2026-01-05') serait interprété en UTC). */
export function depuisIso(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j);
}

const fmtCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

export function formaterDate(iso) {
  if (!iso) return '';
  const d = depuisIso(iso.slice(0, 10));
  const memeAnnee = d.getFullYear() === new Date().getFullYear();
  return (memeAnnee ? fmtCourt : fmtLong).format(d);
}

export function formaterDateHeure(isoComplet) {
  if (!isoComplet) return '';
  const d = new Date(isoComplet);
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** Nombre de jours entre aujourd'hui et une échéance (négatif = en retard). */
export function joursRestants(iso) {
  const jour = 86400000;
  return Math.round((depuisIso(iso.slice(0, 10)) - depuisIso(aujourdhui())) / jour);
}

export function ajouterDelai(date, nb, unite) {
  const d = new Date(date.getTime());
  if (unite === 'jour') d.setDate(d.getDate() + nb);
  else if (unite === 'semaine') d.setDate(d.getDate() + nb * 7);
  else if (unite === 'mois') d.setMonth(d.getMonth() + nb);
  else if (unite === 'annee') d.setFullYear(d.getFullYear() + nb);
  return d;
}
