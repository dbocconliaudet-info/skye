// Accès aux données. Tout passe par le SDK Supabase chargé depuis un CDN :
// pas d'étape de build, le navigateur télécharge le module directement.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_CLE_PUBLIQUE } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

/** Déballe une réponse Supabase en levant une erreur lisible en cas de pépin. */
function ok({ data, error }) {
  if (error) throw new Error(error.message || 'Erreur de connexion à la base');
  return data;
}

// ── Espaces et membres ─────────────────────────────────────────────────────

function jetonAleatoire(longueur = 22) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';   // sans caractères ambigus
  const octets = crypto.getRandomValues(new Uint8Array(longueur));
  return [...octets].map((o) => alphabet[o % alphabet.length]).join('');
}

export async function creerEspace(nom, prenom1, prenom2) {
  const espace = ok(await sb.from('espaces')
    .insert({ nom, lien_invitation: jetonAleatoire() })
    .select().single());

  const membres = ok(await sb.from('membres')
    .insert([
      { espace_id: espace.id, prenom: prenom1 },
      { espace_id: espace.id, prenom: prenom2 },
    ])
    .select());

  // Liste de courses permanente, créée d'office (§7 : toujours présente).
  ok(await sb.from('listes_courses')
    .insert({ espace_id: espace.id, nom: 'Liste permanente', type: 'permanente' }));

  return { espace, membres };
}

export async function espaceParJeton(jeton) {
  const { data, error } = await sb.from('espaces')
    .select('id, nom, lien_invitation').eq('lien_invitation', jeton).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function espaceParId(id) {
  const { data, error } = await sb.from('espaces')
    .select('id, nom, lien_invitation').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export const chargerMembres = async (espaceId) =>
  ok(await sb.from('membres').select('*').eq('espace_id', espaceId).order('cree_le'));

// ── Tâches ─────────────────────────────────────────────────────────────────

export const chargerTaches = async (espaceId) =>
  ok(await sb.from('taches').select('*').eq('espace_id', espaceId).order('cree_le', { ascending: false }));

export const creerTache = async (tache) =>
  ok(await sb.from('taches').insert(tache).select().single());

export const majTache = async (id, patch) =>
  ok(await sb.from('taches').update(patch).eq('id', id).select().single());

export const supprimerTache = async (id) =>
  ok(await sb.from('taches').delete().eq('id', id));

/** Crée une occurrence récurrente en tolérant le doublon : si l'autre téléphone
 *  vient de la créer, l'index unique la rejette (code 23505) et c'est très bien. */
export async function creerOccurrence(tache) {
  const { data, error } = await sb.from('taches').insert(tache).select().single();
  if (error) {
    if (error.code === '23505') return null;
    throw new Error(error.message);
  }
  return data;
}

// ── Courses ────────────────────────────────────────────────────────────────

export const chargerListes = async (espaceId) =>
  ok(await sb.from('listes_courses').select('*').eq('espace_id', espaceId).order('cree_le'));

export const creerListe = async (espaceId, nom, type = 'annexe') =>
  ok(await sb.from('listes_courses').insert({ espace_id: espaceId, nom, type }).select().single());

export const majListe = async (id, patch) =>
  ok(await sb.from('listes_courses').update(patch).eq('id', id).select().single());

export const supprimerListe = async (id) =>
  ok(await sb.from('listes_courses').delete().eq('id', id));

/** Articles non cochés de l'espace. Un article coché disparaît de la liste (§7) :
 *  on ne le rapatrie donc jamais, ce qui garde le chargement léger dans la durée. */
export const chargerArticles = async (espaceId) =>
  ok(await sb.from('articles_courses')
    .select('*').eq('espace_id', espaceId).eq('coche', false).order('cree_le'));

export const ajouterArticles = async (articles) =>
  ok(await sb.from('articles_courses').insert(articles).select());

export const majArticle = async (id, patch) =>
  ok(await sb.from('articles_courses').update(patch).eq('id', id).select().single());

export const supprimerArticle = async (id) =>
  ok(await sb.from('articles_courses').delete().eq('id', id));

/** Articles d'une liste clôturée, pour l'historique et la duplication. */
export const articlesDeListe = async (listeId) =>
  ok(await sb.from('articles_courses').select('*').eq('liste_id', listeId).order('cree_le'));

// ── Dictionnaire de rayons appris ──────────────────────────────────────────

export const chargerDico = async (espaceId) =>
  ok(await sb.from('dictionnaire_rayons').select('mot, rayon').eq('espace_id', espaceId));

export const apprendreRayon = async (espaceId, mot, rayon) =>
  ok(await sb.from('dictionnaire_rayons')
    .upsert({ espace_id: espaceId, mot, rayon }, { onConflict: 'espace_id,mot' }));

// ── Temps réel ─────────────────────────────────────────────────────────────

/** S'abonne aux modifications de l'espace. `auChangement(table)` est appelé à
 *  chaque insert/update/delete venant de l'autre téléphone. */
export function abonner(espaceId, auChangement) {
  const canal = sb.channel(`espace-${espaceId}`);
  for (const table of ['taches', 'listes_courses', 'articles_courses', 'membres', 'dictionnaire_rayons']) {
    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `espace_id=eq.${espaceId}` },
      (msg) => auChangement(table, msg),
    );
  }
  canal.subscribe();
  return () => sb.removeChannel(canal);
}
