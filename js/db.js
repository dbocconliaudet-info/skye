// Accès aux données. Tout passe par le SDK Supabase chargé depuis un CDN :
// pas d'étape de build, le navigateur télécharge le module directement.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_CLE_PUBLIQUE } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, {
  auth: {
    // La session vit désormais sur l'appareil et se renouvelle toute seule :
    // c'est ce qui évite de retaper son mot de passe à chaque ouverture.
    // La durée maximale, elle, se règle dans le tableau de bord Supabase.
    persistSession: true,
    autoRefreshToken: true,
    // Nécessaire pour le lien « mot de passe oublié », qui revient dans l'app
    // avec un jeton de récupération dans l'adresse.
    detectSessionInUrl: true,
    // Volontairement inchangé malgré le renommage en Skye : cette clé désigne
    // la session stockée sur l'appareil. La renommer déconnecterait tout le
    // monde sans rien apporter — elle n'est jamais affichée.
    storageKey: 'todomtadam.auth',
  },
  realtime: { params: { eventsPerSecond: 5 } },
});

/** Déballe une réponse Supabase en levant une erreur lisible en cas de pépin. */
function ok({ data, error }) {
  if (error) throw new Error(error.message || 'Erreur de connexion à la base');
  return data;
}

// ── Comptes ────────────────────────────────────────────────────────────────

/** Traduit les messages d'erreur de Supabase Auth, qui arrivent en anglais. */
function messageAuth(erreur) {
  const brut = erreur?.message || '';
  if (/Invalid login credentials/i.test(brut)) return 'Email ou mot de passe incorrect';
  if (/Email not confirmed/i.test(brut)) return 'Cet email n’a pas encore été confirmé';
  if (/User already registered|already been registered/i.test(brut)) {
    return 'Un compte existe déjà avec cet email — utilise « Se connecter »';
  }
  if (/Password should be at least/i.test(brut)) return 'Mot de passe trop court (6 caractères minimum)';
  if (/Unable to validate email|invalid format/i.test(brut)) return 'Cette adresse email n’est pas valide';
  if (/rate limit|too many/i.test(brut)) return 'Trop de tentatives — réessaie dans quelques minutes';
  return brut || 'Connexion impossible';
}

export async function inscrire(email, motDePasse) {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password: motDePasse });
  if (error) throw new Error(messageAuth(error));
  // Si la confirmation d'email est restée active côté Supabase, il n'y a pas
  // de session : l'app doit le dire clairement plutôt que d'échouer plus loin.
  if (!data.session) {
    throw new Error('Compte créé — confirme ton email, puis reviens te connecter');
  }
  return data.session;
}

export async function connecter(email, motDePasse) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim(), password: motDePasse,
  });
  if (error) throw new Error(messageAuth(error));
  return data.session;
}

export async function deconnecter() {
  await sb.auth.signOut();
}

export async function sessionCourante() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

/** Envoie le lien de réinitialisation, qui ramène sur cette même page. */
export async function demanderNouveauMotDePasse(email) {
  const retour = `${location.origin}${location.pathname}`;
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: retour });
  if (error) throw new Error(messageAuth(error));
}

export async function definirMotDePasse(motDePasse) {
  const { error } = await sb.auth.updateUser({ password: motDePasse });
  if (error) throw new Error(messageAuth(error));
}

// ── Espaces et membres ─────────────────────────────────────────────────────

/** Le membre lié au compte connecté, ou null si le compte n'a pas encore
 *  d'espace (inscription interrompue avant l'étape suivante). */
export async function monMembre() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('membres')
    .select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export const creerEspace = async (nom, pseudo, dateNaissance, dateMariage) =>
  ok(await sb.rpc('creer_espace', {
    p_nom: nom,
    p_pseudo: pseudo,
    p_date_naissance: dateNaissance || null,
    p_date_mariage: dateMariage || null,
  }));

/** Nom de l'espace et membres encore sans compte, pour l'écran « rejoindre ».
 *  Renvoie null si le code ne correspond à aucun espace. */
export const apercuEspace = async (jeton) =>
  ok(await sb.rpc('apercu_espace', { p_jeton: jeton }));

export const rejoindreEspace = async (jeton, pseudo, dateNaissance, membreId) =>
  ok(await sb.rpc('rejoindre_espace', {
    p_jeton: jeton,
    p_pseudo: pseudo,
    p_date_naissance: dateNaissance || null,
    p_membre_id: membreId || null,
  }));

/** `select('*')` et non la liste des colonnes : c'est la troisième fois qu'un
 *  champ ajouté à `espaces` arrive jusqu'ici sans être demandé, et l'oubli est
 *  silencieux — la valeur revient simplement vide. La table tient en cinq
 *  colonnes, toutes utilisées. */
export async function espaceParId(id) {
  const { data, error } = await sb.from('espaces').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export const majEspace = async (id, patch) =>
  ok(await sb.from('espaces').update(patch).eq('id', id).select().single());

export const majMembre = async (id, patch) =>
  ok(await sb.from('membres').update(patch).eq('id', id).select().single());

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

/**
 * Tous les articles des listes **actives** de l'espace, cochés ou non.
 *
 * Les cochés reviennent désormais : la liste permanente est un inventaire, où
 * coché signifie « on en a » et non « acheté, terminé ».
 *
 * D'où la restriction aux listes actives, qui ne servait à rien tant qu'on ne
 * prenait que les non cochés : sans elle, chaque liste ponctuelle clôturée
 * laisserait ses articles s'accumuler dans tous les chargements à venir. Les
 * listes closes se relisent à la demande, via `articlesDeListe`.
 */
export async function chargerArticles(espaceId) {
  const lignes = ok(await sb.from('articles_courses')
    .select('*, listes_courses!inner(statut)')
    .eq('espace_id', espaceId)
    .eq('listes_courses.statut', 'active')
    .order('cree_le'));
  // La jointure ne sert qu'à filtrer : on ne garde pas la liste imbriquée,
  // pour que ces lignes aient la même forme que celles d'`ajouterArticles`.
  return lignes.map(({ listes_courses, ...article }) => article);
}

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

// ── Tricount ───────────────────────────────────────────────────────────────

export const chargerDepenses = async (espaceId) =>
  ok(await sb.from('depenses').select('*').eq('espace_id', espaceId)
    .order('date_depense', { ascending: false }).order('cree_le', { ascending: false }));

export const creerDepense = async (depense) =>
  ok(await sb.from('depenses').insert(depense).select().single());

export const majDepense = async (id, patch) =>
  ok(await sb.from('depenses').update(patch).eq('id', id).select().single());

export const supprimerDepense = async (id) =>
  ok(await sb.from('depenses').delete().eq('id', id));

// ── Anniversaires ──────────────────────────────────────────────────────────

export const chargerAnniversaires = async (espaceId) =>
  ok(await sb.from('anniversaires').select('*').eq('espace_id', espaceId)
    .order('mois').order('jour'));

export const creerAnniversaire = async (anniversaire) =>
  ok(await sb.from('anniversaires').insert(anniversaire).select().single());

export const majAnniversaire = async (id, patch) =>
  ok(await sb.from('anniversaires').update(patch).eq('id', id).select().single());

export const supprimerAnniversaire = async (id) =>
  ok(await sb.from('anniversaires').delete().eq('id', id));

// ── Mots au/à la partenaire ────────────────────────────────────────────────

/** Les mots non lus qui me sont adressés. La base filtre déjà sur le
 *  destinataire — la policy de lecture ne renvoie rien d'autre — mais on le
 *  redit ici pour que la requête soit lisible sans connaître le schéma. */
export const messagesPourMoi = async (espaceId, membreId) =>
  ok(await sb.from('messages')
    .select('*')
    .eq('espace_id', espaceId)
    .eq('lu', false)
    .or(`destinataire_membre_id.eq.${membreId},destinataire_les_deux.is.true`)
    .order('cree_le'));

export const envoyerMessage = async (espaceId, auteurId, destinataireId, contenu) =>
  ok(await sb.from('messages').insert({
    espace_id: espaceId,
    auteur_membre_id: auteurId,
    destinataire_membre_id: destinataireId,
    contenu,
  }));

/** Un mot lu disparaît définitivement (§4 des évolutions : pas d'historique).
 *  On marque plutôt que de supprimer : l'auteur garde ainsi la trace côté base
 *  qu'il l'a bien envoyé, sans que personne puisse le relire dans l'app. */
export const marquerMessageLu = async (id) =>
  ok(await sb.from('messages').update({ lu: true }).eq('id', id));

// ── Temps réel ─────────────────────────────────────────────────────────────

/** S'abonne aux modifications de l'espace. `auChangement(table)` est appelé à
 *  chaque insert/update/delete venant de l'autre téléphone. */
export function abonner(espaceId, auChangement) {
  const canal = sb.channel(`espace-${espaceId}`);

  for (const table of ['taches', 'listes_courses', 'articles_courses', 'membres',
    'dictionnaire_rayons', 'depenses', 'anniversaires']) {
    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `espace_id=eq.${espaceId}` },
      (msg) => auChangement(table, msg),
    );
  }

  // L'espace lui-même, à part : il ne porte pas de colonne `espace_id`, c'est
  // sa propre clé qui l'identifie. Il n'était pas abonné jusqu'ici — ses champs
  // ne changeaient presque jamais — mais le compteur « dernier moment à deux »
  // se remet à zéro d'un téléphone et doit se voir sur l'autre.
  canal.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'espaces', filter: `id=eq.${espaceId}` },
    (msg) => auChangement('espaces', msg),
  );

  canal.subscribe();
  return () => sb.removeChannel(canal);
}
