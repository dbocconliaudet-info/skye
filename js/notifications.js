// Notifications (Web Push) : abonner ce téléphone, ou le désabonner.
//
// L'envoi ne se fait pas d'ici. Deux expéditeurs écrivent aux téléphones inscrits
// dans `push_abonnements`, avec la même clé : le script quotidien sur GitHub
// Actions pour les anniversaires (scripts/rappels.py), et une fonction Supabase
// pour prévenir l'autre d'une tâche ajoutée, à faire ou terminée
// (supabase/functions/prevenir-conjoint).
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

/** Le téléphone est-il inscrit avec une autre clé que celle de l'app ? Ça arrive
 *  quand on change de paire de clés : Apple refuserait alors tous les envois. */
function inscritAvecAncienneCle(abonnement) {
  const cle = abonnement.options?.applicationServerKey;
  if (!cle) return false;
  const attendue = octetsDepuisBase64Url(VAPID_CLE_PUBLIQUE);
  const actuelle = new Uint8Array(cle);
  return actuelle.length !== attendue.length || actuelle.some((o, i) => o !== attendue[i]);
}

async function inscrire() {
  const enregistrement = await navigator.serviceWorker.ready;
  const abonnement = await enregistrement.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: octetsDepuisBase64Url(VAPID_CLE_PUBLIQUE),
  });
  await db.enregistrerAbonnementPush(etat.espaceId, etat.membreId, abonnement);
}

async function activer() {
  // Doit rester la première attente : iOS n'accepte la demande que si elle
  // suit immédiatement l'appui sur le bouton.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('notifications refusées sur ce téléphone');
  }
  // Un téléphone inscrit avec l'ancienne clé doit d'abord se désinscrire, sinon
  // le navigateur refuse la nouvelle inscription.
  const existant = await abonnementActuel();
  if (existant && inscritAvecAncienneCle(existant)) await existant.unsubscribe();
  await inscrire();
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
 *
 * Après un changement de clé, on le réinscrit aussi. Si iOS refuse de le faire
 * sans appui sur un bouton, le téléphone apparaît « non inscrit » dans les
 * réglages, et « Activer les rappels » y remédie.
 */
export async function synchroniserAbonnement() {
  try {
    if (!estPrisEnCharge() || Notification.permission !== 'granted') return;
    const abonnement = await abonnementActuel();
    if (!abonnement) return;
    if (inscritAvecAncienneCle(abonnement)) {
      await db.supprimerAbonnementPush(abonnement.endpoint);
      await abonnement.unsubscribe();
      await inscrire();
      return;
    }
    await db.enregistrerAbonnementPush(etat.espaceId, etat.membreId, abonnement);
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

    const actuel = await abonnementActuel();
    const abonne = Boolean(actuel) && !inscritAvecAncienneCle(actuel)
      && Notification.permission === 'granted';

    hote.append(el('p', { class: 'feuille-info' }, abonne
      ? 'Rappels activés sur ce téléphone : chaque matin vers 8 h 30 les anniversaires du jour, '
        + 'pour ceux marqués 🎁 un rappel 3 semaines puis 1 semaine avant, les tâches récurrentes '
        + 'qui réapparaissent, et ce dont l’autre veut te prévenir.'
      : 'Reçois chaque matin vers 8 h 30 les anniversaires du jour, pour ceux marqués 🎁 '
        + 'un rappel 3 semaines puis 1 semaine avant, les tâches récurrentes qui réapparaissent, '
        + 'et ce dont l’autre veut te prévenir. À activer sur chaque téléphone.'));

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
