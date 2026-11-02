"""Rappels du matin : anniversaires du jour, cadeaux à prévoir et tâches
récurrentes qui réapparaissent (celles où « Prévenir quand elle réapparaît »
est coché).

Lancé chaque matin par GitHub Actions (.github/workflows/rappels.yml). Lit la
base Supabase avec la clé service_role, compose une notification par membre et
l'envoie à chacun de ses téléphones inscrits dans `push_abonnements`.

Variables d'environnement :
  SUPABASE_URL               adresse du projet (publique)
  SUPABASE_SERVICE_ROLE_KEY  clé secrète, contourne les règles RLS — secret GitHub
  VAPID_PRIVATE_KEY          signe les notifications — secret GitHub
  VAPID_SUBJECT              contact exigé par Apple (une adresse https ou mailto)
  MODE                       « quotidien » (défaut) ou « test »

ATTENTION : le dépôt est public, et les journaux de GitHub Actions aussi.
Ce script n'y écrit que des nombres — jamais un nom, une date ou un message.
"""

import json
import os
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from pywebpush import WebPushException, webpush

PARIS = ZoneInfo("Europe/Paris")

# Le matin, pas avant : le passage de 6 h 31 UTC tombe à 7 h 31 en hiver et
# s'arrête ici ; celui de 7 h 31 UTC prend alors le relais (8 h 31 à Paris).
HEURE_MINI = 8

# Délais de l'alerte cadeau, en jours avant l'anniversaire.
RAPPELS_CADEAU = {21: "dans 3 semaines", 7: "dans une semaine"}

# Combien de temps Apple garde une notification pour un téléphone hors ligne
# (mode avion). Au-delà, le rappel du jour n'a plus de sens.
DUREE_DE_VIE = 24 * 3600

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre"]


# ── Base de données ─────────────────────────────────────────────────────────

def sorte_de_cle(cle):
    """Le genre de clé reçu, sans rien en dévoiler : de quoi diagnostiquer un
    refus de Supabase dans des journaux publics."""
    for prefixe, nom in (("sb_secret_", "clé secrète (sb_secret_…)"),
                         ("sb_publishable_", "clé PUBLIQUE (sb_publishable_…) — pas la bonne"),
                         ("eyJ", "ancienne clé JWT (eyJ…)")):
        if cle.startswith(prefixe):
            return nom
    return "clé de format inconnu"


def verifier(r):
    """Comme raise_for_status, mais en affichant d'abord la réponse de
    Supabase : « Invalid API key », « Legacy API keys are disabled »… """
    if not r.ok:
        print(f"Supabase répond HTTP {r.status_code} : {r.text[:300]}")
    r.raise_for_status()


class Base:
    """Accès minimal à l'API REST de Supabase (PostgREST)."""

    def __init__(self, url, cle):
        self.racine = url.rstrip("/") + "/rest/v1/"
        # Un espace ou un retour à la ligne pris au copier-coller suffit à
        # faire refuser la clé.
        cle = cle.strip()
        print(f"clé Supabase reçue : {sorte_de_cle(cle)}, {len(cle)} caractères")
        self.entetes = {"apikey": cle, "Content-Type": "application/json"}
        # Les anciennes clés service_role sont des jetons JWT qu'il faut aussi
        # présenter en « Authorization » ; les nouvelles (sb_secret_…) non.
        if cle.startswith("eyJ"):
            self.entetes["Authorization"] = f"Bearer {cle}"

    def lire(self, table, colonnes="*", filtres=None):
        r = requests.get(self.racine + table, headers=self.entetes,
                         params={"select": colonnes, **(filtres or {})}, timeout=30)
        verifier(r)
        return r.json()

    def reserver_envoi(self, espace_id, jour, sorte):
        """Inscrit l'envoi du jour. Renvoie False s'il était déjà inscrit,
        c'est-à-dire déjà fait par un passage précédent."""
        r = requests.post(
            self.racine + "push_envois",
            headers={**self.entetes,
                     "Prefer": "resolution=ignore-duplicates,return=representation"},
            data=json.dumps({"espace_id": espace_id, "jour": jour.isoformat(), "sorte": sorte}),
            timeout=30)
        verifier(r)
        return bool(r.json())

    def annuler_envoi(self, espace_id, jour, sorte):
        r = requests.delete(self.racine + "push_envois", headers=self.entetes, params={
            "espace_id": f"eq.{espace_id}", "jour": f"eq.{jour.isoformat()}",
            "sorte": f"eq.{sorte}"}, timeout=30)
        verifier(r)

    def marquer_reussite(self, abonnement_id):
        requests.patch(self.racine + "push_abonnements", headers=self.entetes,
                       params={"id": f"eq.{abonnement_id}"},
                       data=json.dumps({"derniere_reussite": datetime.now(PARIS).isoformat()}),
                       timeout=30)

    def supprimer_abonnement(self, abonnement_id):
        requests.delete(self.racine + "push_abonnements", headers=self.entetes,
                        params={"id": f"eq.{abonnement_id}"}, timeout=30)


# ── Dates ───────────────────────────────────────────────────────────────────

def date_dans_annee(annee, mois, jour):
    """Un 29 février se fête le 28 les années non bissextiles — même règle
    que l'app (js/anniversaires.js)."""
    suivant = date(annee + (mois == 12), mois % 12 + 1, 1)
    dernier = (suivant - timedelta(days=1)).day
    return date(annee, mois, min(jour, dernier))


def prochaine_occurrence(aujourdhui, mois, jour):
    cette_annee = date_dans_annee(aujourdhui.year, mois, jour)
    if cette_annee >= aujourdhui:
        return cette_annee
    return date_dans_annee(aujourdhui.year + 1, mois, jour)


def age(occurrence, annee):
    return occurrence.year - annee if annee else None


def avec_age(nom, n):
    return f"{nom} ({n} ans)" if n else nom


# ── Tâches récurrentes ──────────────────────────────────────────────────────
#
# Même calcul que l'app (js/taches.js et js/ui.js), à garder identique : c'est
# lui qui décide du jour où la carte apparaît sur le board.

def ajouter_mois(d, nb):
    """Comme setMonth en JavaScript : un jour qui n'existe pas déborde sur le
    mois suivant (31 mars moins un mois donne le 3 mars)."""
    total = d.year * 12 + d.month - 1 + nb
    return date(total // 12, total % 12 + 1, 1) + timedelta(days=d.day - 1)


def ajouter_delai(d, nb, unite):
    if unite == "jour":
        return d + timedelta(days=nb)
    if unite == "semaine":
        return d + timedelta(weeks=nb)
    if unite == "mois":
        return ajouter_mois(d, nb)
    if unite == "annee":
        return ajouter_mois(d, 12 * nb)
    return d


def prochaine_echeance(d, rec):
    """Échéance suivante d'une tâche récurrente : « tous les mois le 31 »
    tombe au 28 ou au 30 quand le 31 n'existe pas."""
    n = max(1, int(rec.get("intervalle") or 1))
    if rec.get("frequence") == "jour":
        return d + timedelta(days=n)
    if rec.get("frequence") == "semaine":
        return d + timedelta(weeks=n)
    mois_en_plus = 12 * n if rec.get("frequence") == "annee" else n
    jour_voulu = (int(rec.get("jour") or 0) or d.day) if rec.get("frequence") == "mois" else d.day
    cible = ajouter_mois(date(d.year, d.month, 1), mois_en_plus)
    return date_dans_annee(cible.year, cible.month, jour_voulu)


def date_apparition(echeance, rec):
    if not rec or not rec.get("delai_nb"):
        return echeance
    return ajouter_delai(echeance, -int(rec["delai_nb"]), rec.get("delai_unite") or "jour")


def taches_qui_reapparaissent(taches, aujourdhui):
    """Les tâches à signaler ce matin. Que l'occurrence existe déjà (l'un de
    vous a ouvert l'app avant 8 h 30) ou pas encore (personne ne l'a ouverte),
    le résultat est le même : on refait le calcul de l'app."""
    series = {}
    for t in taches:
        rec = t.get("recurrence") or {}
        if rec.get("serie") and t.get("date_limite"):
            series.setdefault(rec["serie"], []).append(t)

    a_signaler = []
    for lot in series.values():
        # Les occurrences déjà créées.
        for t in lot:
            echeance = date.fromisoformat(t["date_limite"])
            if (t["recurrence"].get("prevenir") and t["statut"] != "fait"
                    and not t.get("devenu_sans_objet")
                    and date_apparition(echeance, t["recurrence"]) == aujourdhui):
                a_signaler.append({**t, "echeance": echeance})

        # Celles que l'app créera à sa prochaine ouverture.
        modele = max(lot, key=lambda t: t["date_limite"])
        rec = modele["recurrence"]
        echeance = date.fromisoformat(modele["date_limite"])
        for _ in range(24):  # même garde-fou que l'app
            suivante = prochaine_echeance(echeance, rec)
            apparition = date_apparition(suivante, rec)
            if suivante <= echeance or apparition > aujourdhui:
                break
            if rec.get("prevenir") and apparition == aujourdhui:
                a_signaler.append({**modele, "echeance": suivante})
            echeance = suivante
    return a_signaler


def ligne_tache(t, aujourdhui):
    if t["echeance"] == aujourdhui:
        return f"🔁 {t['titre']} : pour aujourd’hui"
    return f"🔁 {t['titre']} : pour le {t['echeance'].day} {MOIS[t['echeance'].month - 1]}"


def concerne(t, membre_id):
    """Assignée à ce membre, ou aux deux."""
    return t.get("assigne_aux_deux") or not t.get("assigne_a") or t["assigne_a"] == membre_id


# ── Composition ─────────────────────────────────────────────────────────────

def dates_de_l_espace(espace, membres, anniversaires):
    """Toutes les dates à surveiller : les anniversaires saisis, ceux des
    membres (réglages « Nos dates ») et la date de mariage ou de PACS."""
    dates = []
    for a in anniversaires:
        dates.append({"sorte": "saisi", "nom": a["nom"], "mois": a["mois"], "jour": a["jour"],
                      "annee": a.get("annee"), "cadeau": a.get("prevoir_cadeau", False)})
    for m in membres:
        if m.get("date_naissance"):
            a, mo, j = map(int, m["date_naissance"].split("-"))
            dates.append({"sorte": "membre", "membre_id": m["id"], "nom": m["pseudo"],
                          "mois": mo, "jour": j, "annee": a})
    if espace.get("date_mariage_pacs"):
        a, mo, j = map(int, espace["date_mariage_pacs"].split("-"))
        dates.append({"sorte": "union", "nom": "", "mois": mo, "jour": j, "annee": a})
    return dates


def lignes_pour(membre_id, dates, aujourdhui):
    """Ce que ce membre doit lire ce matin. Les anniversaires du jour d'abord,
    puis les cadeaux à prévoir."""
    du_jour, cadeaux = [], []
    for d in dates:
        quand = prochaine_occurrence(aujourdhui, d["mois"], d["jour"])
        delai = (quand - aujourdhui).days
        n = age(quand, d["annee"])

        if delai == 0:
            if d["sorte"] == "union":
                du_jour.append(f"💍 {n} ans de mariage aujourd’hui !" if n
                               else "💍 C’est votre anniversaire de mariage !")
            elif d["sorte"] == "membre" and d["membre_id"] == membre_id:
                du_jour.append("🎉 Joyeux anniversaire !")
            else:
                du_jour.append(f"🎂 Anniversaire de {avec_age(d['nom'], n)}")

        elif delai in RAPPELS_CADEAU:
            # Le cadeau du ou de la partenaire est rappelé à l'autre seulement :
            # ce serait gâcher la surprise que de le rappeler aux deux.
            pour_l_autre = d["sorte"] == "membre" and d["membre_id"] != membre_id
            if (d["sorte"] == "saisi" and d["cadeau"]) or pour_l_autre:
                le = f"le {quand.day} {MOIS[quand.month - 1]}"
                cadeaux.append(f"🎁 Cadeau pour {d['nom']} : {RAPPELS_CADEAU[delai]} ({le})")

    return du_jour + cadeaux


def message(lignes, aujourdhui):
    if len(lignes) > 1:
        titre = "Skye · rappels du jour"
    elif lignes[0].startswith("🎁"):
        titre = "Cadeau à prévoir"
    elif lignes[0].startswith("🔁"):
        titre = "Tâche à faire"
    else:
        titre = "Anniversaire aujourd’hui"
    return {
        "titre": titre,
        "corps": "\n".join(lignes),
        # Même étiquette pour toute la journée : si un envoi arrivait deux fois
        # malgré tout, le second remplacerait le premier au lieu de s'empiler.
        "tag": f"rappels-{aujourdhui.isoformat()}",
        "url": "./",
    }


# ── Envoi ───────────────────────────────────────────────────────────────────

def envoyer(base, abonnement, contenu, cle_privee, sujet):
    """« ok » si Apple (ou Google, Mozilla) a accepté la notification,
    « perime » si le téléphone n'est plus inscrit, « echec » sinon."""
    try:
        webpush(
            subscription_info={"endpoint": abonnement["endpoint"],
                               "keys": {"p256dh": abonnement["p256dh"], "auth": abonnement["auth"]}},
            data=json.dumps(contenu, ensure_ascii=False),
            vapid_private_key=cle_privee,
            vapid_claims={"sub": sujet},
            ttl=DUREE_DE_VIE,
            timeout=30,
        )
    except WebPushException as e:
        statut = e.response.status_code if e.response is not None else None
        # 404 / 410 : l'abonnement n'existe plus (app supprimée, notifications
        # coupées). On l'efface ; l'app le recrée si on réactive.
        if statut in (404, 410):
            base.supprimer_abonnement(abonnement["id"])
            print(f"  abonnement périmé supprimé (HTTP {statut})")
            return "perime"
        print(f"  échec d'envoi (HTTP {statut})")
        return "echec"
    base.marquer_reussite(abonnement["id"])
    return "ok"


def main():
    manquants = [nom for nom in ("SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY")
                 if not os.environ.get(nom, "").strip()]
    if manquants:
        print("Secret(s) GitHub vide(s) ou introuvable(s) : " + ", ".join(manquants))
        print("À vérifier dans Settings › Secrets and variables › Actions, onglet Secrets,")
        print("section « Repository secrets » : le nom doit être exactement celui-ci.")
        return 1

    base = Base(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    cle_privee = os.environ["VAPID_PRIVATE_KEY"].strip()
    sujet = os.environ["VAPID_SUBJECT"]
    mode = os.environ.get("MODE") or "quotidien"

    maintenant = datetime.now(PARIS)
    aujourdhui = maintenant.date()
    abonnements = base.lire("push_abonnements", "id,espace_id,membre_id,endpoint,p256dh,auth")
    print(f"{maintenant:%Y-%m-%d %H:%M} (Paris) — mode {mode}, {len(abonnements)} téléphone(s) inscrit(s)")

    if mode == "test":
        contenu = {"titre": "Skye", "corps": "Test réussi : les rappels arriveront bien ici.",
                   "tag": "test", "url": "./"}
        issues = [envoyer(base, a, contenu, cle_privee, sujet) for a in abonnements]
        print(f"test : {issues.count('ok')}/{len(abonnements)} envoyé(s)")
        return 1 if "echec" in issues or not issues else 0

    if maintenant.hour < HEURE_MINI:
        print("trop tôt à Paris, le passage suivant s'en charge")
        return 0

    espaces = base.lire("espaces", "id,date_mariage_pacs")
    membres = base.lire("membres", "id,espace_id,pseudo,date_naissance")
    anniversaires = base.lire("anniversaires", "espace_id,nom,jour,mois,annee,prevoir_cadeau")
    taches = base.lire("taches",
                       "espace_id,titre,assigne_a,assigne_aux_deux,statut,devenu_sans_objet,date_limite,recurrence",
                       {"recurrence": "not.is.null"})

    echecs = 0
    for espace in espaces:
        abonnes = [a for a in abonnements if a["espace_id"] == espace["id"]]
        if not abonnes:
            continue
        dates = dates_de_l_espace(
            espace,
            [m for m in membres if m["espace_id"] == espace["id"]],
            [a for a in anniversaires if a["espace_id"] == espace["id"]])
        a_faire = taches_qui_reapparaissent(
            [t for t in taches if t["espace_id"] == espace["id"]], aujourdhui)

        a_envoyer = []
        for abonnement in abonnes:
            lignes = lignes_pour(abonnement["membre_id"], dates, aujourdhui)
            lignes += [ligne_tache(t, aujourdhui) for t in a_faire
                       if concerne(t, abonnement["membre_id"])]
            if lignes:
                a_envoyer.append((abonnement, message(lignes, aujourdhui)))
        if not a_envoyer:
            continue

        # « anniversaires » est un nom historique : il couvre tout le rappel du
        # matin, tâches comprises. Le changer ferait renvoyer celui du jour.
        if not base.reserver_envoi(espace["id"], aujourdhui, "anniversaires"):
            print("espace déjà notifié aujourd'hui, rien à faire")
            continue

        issues = [envoyer(base, a, contenu, cle_privee, sujet) for a, contenu in a_envoyer]
        print(f"espace : {issues.count('ok')}/{len(a_envoyer)} notification(s) envoyée(s)")
        if "ok" not in issues:
            # Rien n'est parti (Apple injoignable, par exemple) : on libère la
            # journée pour que le passage suivant retente.
            base.annuler_envoi(espace["id"], aujourdhui, "anniversaires")
        if "echec" in issues:
            echecs += 1

    return 1 if echecs else 0


if __name__ == "__main__":
    sys.exit(main())
