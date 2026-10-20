// Notifications (Web Push) : abonner ce téléphone, ou le désabonner.
//
// L'envoi ne se fait pas d'ici : c'est un script quotidien sur GitHub Actions
// qui lit les anniversaires et écrit aux téléphones inscrits dans
// `push_abonnements` (voir scripts/rappels.py).
//
// Sur iPhone, trois conditions, toutes imposées par Apple :
// - iOS 16.4 ou plus récent ;
// - Skye ouverte depuis l'icône de l'écran d'accueil, pas depuis Safari ;
// - la demande d'autorisation part d'un appui sur un bouton, jamais toute seule.

import { el, toast } from './ui.js';
import { etat } from './etat.js';
import { VAPID_CLE_PUBLIQUE } from './config.js';
import * as db from './db.js';

const estPrisEnCharge = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone ou iPad ouvert dans Safari plutôt que depuis l'écran d'accueil :
 *  c'est le cas où il suffit d'un geste pour que ça marche, autant le dire. */
const iosHorsEcranAccueil = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone;

/** La clé VAPID circule en base64 « URL », le navigateur la veut en octets. */
function octetsDepuisBase64Url(texte) {
  const base64 = (texte + '='.repeat((4 - (texte.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function abonnementActuel() {
  if (!estPrisEnCharge()) return null;
  const enregistrement = await navigator.serviceWorker.ready;
  return enregistrement.pushManager.getSubscription();
}

async function activer() {
  // Doit rester la première attente : iOS n'accepte la demande que si elle
  // suit immédiatement l'appui sur le bouton.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('notifications refusées sur ce téléphone');
  }
  const enregistrement = await navigator.serviceWorker.ready;
  const abonnement = await enregistrement.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: octetsDepuisBase64Url(VAPID_CLE_PUBLIQUE),
  });
  await db.enregistrerAbonnementPush(etat.espaceId, etat.membreId, abonnement);
}

async function desactiver() {
  const abonnement = await abonnementActuel();
  if (!abonnement) return;
  await db.supprimerAbonnementPush(abonnement.endpoint);
  await abonnement.unsubscribe();
}

/**
 * À l'ouverture de l'app : si ce téléphone est abonné, on redit sa ligne à la
 * base. Le navigateur renouvelle parfois l'abonnement de lui-même, et le
 * script d'envoi efface ceux qu'Apple déclare périmés : sans ce rappel, un
 * téléphone pourrait cesser de recevoir les rappels sans que rien ne l'affiche.
 */
export async function synchroniserAbonnement() {
  try {
    if (!estPrisEnCharge() || Notification.permission !== 'granted') return;
    const abonnement = await abonnementActuel();
    if (abonnement) await db.enregistrerAbonnementPush(etat.espaceId, etat.membreId, abonnement);
  } catch { /* hors ligne : on réessaiera à la prochaine ouverture */ }
}

/**
 * Avant de se déconnecter : un téléphone déconnecté ne doit plus rien recevoir
 * — c'est peut-être un téléphone qu'on prête ou qu'on revend.
 *
 * On retire seulement sa ligne en base, sans désabonner le téléphone lui-même :
 * à la reconnexion, `synchroniserAbonnement` la recrée toute seule, et les
 * rappels reprennent sans avoir à réappuyer sur « Activer ». Si c'est un autre
 * compte qui se connecte, la ligne est recréée à son nom.
 *
 * À appeler tant que la session existe encore, la base l'exige pour effacer.
 */
export async function oublierCeTelephone() {
  try {
    const abonnement = await abonnementActuel();
    if (abonnement) await db.supprimerAbonnementPush(abonnement.endpoint);
  } catch { /* sans réseau : la ligne restera, sans gravité */ }
}

/** Section « Rappels » des réglages. */
export function sectionNotifications() {
  const hote = el('div', {});

  const dessiner = async () => {
    hote.replaceChildren(el('h3', { class: 'feuille-titre' }, 'Rappels'));

    if (!estPrisEnCharge()) {
      hote.append(el('p', { class: 'feuille-info' }, iosHorsEcranAccueil()
        ? 'Pour recevoir les rappels, ouvre Skye depuis son icône sur l’écran d’accueil '
          + '(dans Safari : Partager, puis « Sur l’écran d’accueil »).'
        : 'Ce téléphone ou ce navigateur ne sait pas recevoir de notifications. '
          + 'Sur iPhone, il faut iOS 16.4 ou plus récent.'));
      return;
    }

    if (Notification.permission === 'denied') {
      hote.append(el('p', { class: 'feuille-info' },
        'Les notifications de Skye sont coupées sur ce téléphone. Pour les rétablir : '
        + 'Réglages de l’iPhone › Notifications › Skye.'));
      return;
    }

    const abonne = Boolean(await abonnementActuel()) && Notification.permission === 'granted';

    hote.append(el('p', { class: 'feuille-info' }, abonne
      ? 'Rappels activés sur ce téléphone : chaque matin vers 8 h 30 les anniversaires du jour, '
        + 'et pour ceux marqués 🎁 un rappel 3 semaines puis 1 semaine avant.'
      : 'Reçois chaque matin vers 8 h 30 les anniversaires du jour, et pour ceux marqués 🎁 '
        + 'un rappel 3 semaines puis 1 semaine avant. À activer sur chaque téléphone.'));

    const bouton = el('button', {
      class: 'btn btn-secondaire',
      onclick: async () => {
        bouton.disabled = true;
        bouton.textContent = abonne ? 'Désactivation…' : 'Activation…';
        try {
          if (abonne) await desactiver(); else await activer();
          toast(abonne ? 'Rappels désactivés sur ce téléphone' : 'Rappels activés sur ce téléphone');
        } catch (err) {
          toast(`Impossible : ${err.message}`);
        }
        dessiner();
      },
    }, abonne ? 'Désactiver les rappels sur ce téléphone' : 'Activer les rappels');
    hote.append(bouton);
  };

  dessiner();
  return hote;
}
