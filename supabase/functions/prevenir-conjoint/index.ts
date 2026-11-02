// Prévient l'autre membre de l'espace au sujet d'une tâche. Trois sortes :
//   creee    je viens de l'ajouter
//   relance  petit rappel : elle n'est pas encore faite
//   fait     je viens de la terminer (sorte par défaut)
//
// Appelée par l'app (js/taches.js). À déployer dans Supabase › Edge Functions,
// sous le nom « prevenir-conjoint ».
//
// Secret à créer dans Supabase › Edge Functions › Secrets :
//   VAPID_PRIVATE_KEY  la même valeur que le secret GitHub du même nom
//
// L'app n'envoie que l'identifiant de la tâche et la sorte : le texte est composé
// ici, et le destinataire déduit d'ici. Un membre ne peut donc écrire qu'à l'autre
// membre de son espace, au sujet d'une tâche de cet espace.
//
// Les réapparitions des tâches récurrentes ne passent pas par ici : elles partent
// avec les rappels du matin (scripts/rappels.py), puisque personne n'appuie sur
// rien à ce moment-là.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

// Publique, identique à VAPID_CLE_PUBLIQUE de js/config.js.
const VAPID_CLE_PUBLIQUE = "BCpxUk3GcfeCXHRXV9M8QVE8iLJscqIkeTgYVHJ1AgF4pPlly757f5mq6vywqgRmjcFtX4kI1dvXWa_TNtrLvBg";
const VAPID_SUBJECT = "https://dbocconliaudet-info.github.io";

// Combien de temps Apple garde la notification pour un téléphone hors ligne.
const DUREE_DE_VIE = 24 * 3600;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

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

/** « 12 novembre » depuis « 2026-11-12 ». */
function formaterJour(iso: string): string {
  const [, m, j] = iso.split("-").map(Number);
  return `${j} ${MOIS[m - 1]}`;
}

interface Tache {
  id: string;
  titre: string;
  note_de_cloture: string | null;
  statut: string;
  devenu_sans_objet: boolean;
  date_limite: string | null;
  cree_par: string | null;
  termine_par: string | null;
  termine_le: string | null;
  conjoint_prevenu_pour: string | null;
}

/** Ce que chaque sorte exige de la tâche, et le texte de la notification. */
const SORTES: Record<string, {
  permise: (t: Tache, moi: string) => boolean;
  titre: (pseudo: string) => string;
  corps: (t: Tache) => string;
}> = {
  creee: {
    permise: (t, moi) => t.cree_par === moi && t.statut !== "fait",
    titre: (p) => `${p} a ajouté une tâche`,
    corps: (t) => t.date_limite ? `${t.titre}\nÀ faire pour le ${formaterJour(t.date_limite)}` : t.titre,
  },
  relance: {
    permise: (t) => t.statut !== "fait" && !t.devenu_sans_objet,
    titre: (p) => `Petit rappel de ${p}`,
    corps: (t) => t.date_limite ? `${t.titre}\nÀ faire pour le ${formaterJour(t.date_limite)}` : t.titre,
  },
  fait: {
    permise: (t, moi) => t.statut === "fait" && t.termine_par === moi,
    titre: (p) => `${p} a terminé une tâche`,
    corps: (t) => t.note_de_cloture ? `${t.titre}\n« ${t.note_de_cloture} »` : t.titre,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const base = createClient(Deno.env.get("SUPABASE_URL")!, cleSecrete(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Qui appelle ?
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await base.auth.getUser(jeton);
  if (!user) return reponse({ erreur: "non connecté" }, 401);

  const { tache_id, sorte = "fait" } = await req.json().catch(() => ({ tache_id: null }));
  if (!tache_id) return reponse({ erreur: "tâche manquante" }, 400);
  const regle = SORTES[sorte];
  if (!regle) return reponse({ erreur: "sorte inconnue" }, 400);

  const { data: moi, error: e1 } = await base.from("membres")
    .select("id,espace_id,pseudo").eq("user_id", user.id).maybeSingle();
  if (e1) throw e1;
  if (!moi) return reponse({ erreur: "aucun espace" }, 403);

  const { data: tache, error: e2 } = await base.from("taches")
    .select("id,titre,note_de_cloture,statut,devenu_sans_objet,date_limite,cree_par,termine_par,termine_le,conjoint_prevenu_pour")
    .eq("id", tache_id).eq("espace_id", moi.espace_id).maybeSingle();
  if (e2) throw e2;
  if (!tache || !regle.permise(tache, moi.id)) {
    return reponse({ erreur: "tâche introuvable ou pas dans le bon état" }, 403);
  }

  const { data: abonnements, error: e3 } = await base.from("push_abonnements")
    .select("id,endpoint,p256dh,auth")
    .eq("espace_id", moi.espace_id).neq("membre_id", moi.id);
  if (e3) throw e3;
  if (!abonnements?.length) return reponse({ envoyes: 0, raison: "pas_de_telephone" });

  // Un seul envoi par clôture pour « fait ». Pour les autres, une ligne dans le
  // journal des envois : une fois par jour pour « creee » (l'app ne l'appelle
  // qu'à la création), une fois par heure pour « relance » — assez pour
  // insister, pas assez pour harceler.
  let journal: { espace_id: string; jour: string; sorte: string } | null = null;
  if (sorte === "fait") {
    if (tache.conjoint_prevenu_pour === tache.termine_le) {
      return reponse({ envoyes: 0, raison: "deja_prevenu" });
    }
  } else {
    const maintenant = new Date().toISOString();
    journal = {
      espace_id: moi.espace_id,
      jour: maintenant.slice(0, 10),
      sorte: sorte === "creee" ? `creee-${tache.id}` : `relance-${tache.id}-${maintenant.slice(11, 13)}h`,
    };
    const { data: inscrit, error: e4 } = await base.from("push_envois")
      .upsert(journal, { onConflict: "espace_id,jour,sorte", ignoreDuplicates: true }).select();
    if (e4) throw e4;
    if (!inscrit?.length) return reponse({ envoyes: 0, raison: "deja_prevenu" });
  }

  const contenu = JSON.stringify({
    titre: regle.titre(moi.pseudo),
    corps: regle.corps(tache),
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

  if (!envoyes) {
    // Rien n'est parti : on libère la place pour qu'un nouvel essai soit possible.
    if (journal) {
      await base.from("push_envois").delete()
        .eq("espace_id", journal.espace_id).eq("jour", journal.jour).eq("sorte", journal.sorte);
    }
    return reponse({ envoyes: 0, raison: "echec" });
  }

  if (sorte === "fait") {
    await base.from("taches")
      .update({ conjoint_prevenu_pour: tache.termine_le }).eq("id", tache.id);
  }
  return reponse({ envoyes });
});
