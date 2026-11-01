// Prévient l'autre membre de l'espace qu'une tâche vient d'être terminée.
//
// Appelée par l'app (js/taches.js) quand « Prévenir » est coché. À déployer dans
// Supabase › Edge Functions, sous le nom « prevenir-conjoint ».
//
// Secret à créer dans Supabase › Edge Functions › Secrets :
//   VAPID_PRIVATE_KEY  la même valeur que le secret GitHub du même nom
//
// L'app n'envoie que l'identifiant de la tâche : le texte est composé ici, et le
// destinataire déduit d'ici. Un membre ne peut donc écrire qu'à l'autre membre
// de son espace, au sujet d'une tâche qu'il vient lui-même de terminer.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

// Publique, identique à VAPID_CLE_PUBLIQUE de js/config.js.
const VAPID_CLE_PUBLIQUE = "BCpxUk3GcfeCXHRXV9M8QVE8iLJscqIkeTgYVHJ1AgF4pPlly757f5mq6vywqgRmjcFtX4kI1dvXWa_TNtrLvBg";
const VAPID_SUBJECT = "https://dbocconliaudet-info.github.io";

// Combien de temps Apple garde la notification pour un téléphone hors ligne.
const DUREE_DE_VIE = 24 * 3600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reponse = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Les nouvelles clés secrètes arrivent dans un dictionnaire ; l'ancienne
 *  variable sert de secours sur les projets qui l'utilisent encore. */
function cleSecrete(): string {
  const cles = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (cles) return JSON.parse(cles)["default"];
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

/** Le secret ne contient que le nombre privé, comme pour scripts/rappels.py ;
 *  la bibliothèque veut la paire complète, au format JWK. */
function clesVapid(): webpush.ExportedVapidKeys {
  const base64 = VAPID_CLE_PUBLIQUE.replace(/-/g, "+").replace(/_/g, "/");
  const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const enBase64Url = (o: Uint8Array) =>
    btoa(String.fromCharCode(...o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const commun = {
    kty: "EC",
    crv: "P-256",
    x: enBase64Url(octets.slice(1, 33)),
    y: enBase64Url(octets.slice(33, 65)),
  };
  return {
    publicKey: commun,
    privateKey: { ...commun, d: Deno.env.get("VAPID_PRIVATE_KEY")!.trim() },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const base = createClient(Deno.env.get("SUPABASE_URL")!, cleSecrete(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Qui appelle ?
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await base.auth.getUser(jeton);
  if (!user) return reponse({ erreur: "non connecté" }, 401);

  const { tache_id } = await req.json().catch(() => ({ tache_id: null }));
  if (!tache_id) return reponse({ erreur: "tâche manquante" }, 400);

  const { data: moi, error: e1 } = await base.from("membres")
    .select("id,espace_id,pseudo").eq("user_id", user.id).maybeSingle();
  if (e1) throw e1;
  if (!moi) return reponse({ erreur: "aucun espace" }, 403);

  const { data: tache, error: e2 } = await base.from("taches")
    .select("id,titre,note_de_cloture,statut,termine_par,termine_le,conjoint_prevenu_pour")
    .eq("id", tache_id).eq("espace_id", moi.espace_id).maybeSingle();
  if (e2) throw e2;
  if (!tache || tache.statut !== "fait" || tache.termine_par !== moi.id) {
    return reponse({ erreur: "tâche introuvable ou pas terminée par toi" }, 403);
  }

  if (tache.conjoint_prevenu_pour === tache.termine_le) {
    return reponse({ envoyes: 0, raison: "deja_prevenu" });
  }

  const { data: abonnements, error: e3 } = await base.from("push_abonnements")
    .select("id,endpoint,p256dh,auth")
    .eq("espace_id", moi.espace_id).neq("membre_id", moi.id);
  if (e3) throw e3;
  if (!abonnements?.length) return reponse({ envoyes: 0, raison: "pas_de_telephone" });

  const contenu = JSON.stringify({
    titre: `${moi.pseudo} a terminé une tâche`,
    corps: tache.note_de_cloture ? `${tache.titre}\n« ${tache.note_de_cloture} »` : tache.titre,
    tag: `tache-${tache.id}`,
    url: "./",
  });

  const serveur = await webpush.ApplicationServer.new({
    contactInformation: VAPID_SUBJECT,
    vapidKeys: await webpush.importVapidKeys(clesVapid()),
  });

  let envoyes = 0;
  for (const a of abonnements) {
    try {
      await serveur.subscribe({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } })
        .pushTextMessage(contenu, { ttl: DUREE_DE_VIE, urgency: webpush.Urgency.High });
      envoyes++;
      await base.from("push_abonnements")
        .update({ derniere_reussite: new Date().toISOString() }).eq("id", a.id);
    } catch (e) {
      const statut = e instanceof webpush.PushMessageError ? e.response.status : null;
      console.log(`échec d'envoi (HTTP ${statut})`);
      // 404 / 410 : le téléphone n'est plus inscrit, l'app le recréera si besoin.
      if (statut === 404 || statut === 410) {
        await base.from("push_abonnements").delete().eq("id", a.id);
      }
    }
  }

  if (!envoyes) return reponse({ envoyes: 0, raison: "echec" });

  await base.from("taches")
    .update({ conjoint_prevenu_pour: tache.termine_le }).eq("id", tache.id);
  return reponse({ envoyes });
});
