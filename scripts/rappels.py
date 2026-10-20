"""Rappels du matin : anniversaires du jour et cadeaux à prévoir.

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

class Base:
    """Accès minimal à l'API REST de Supabase (PostgREST)."""

    def __init__(self, url, cle):
        self.racine = url.rstrip("/") + "/rest/v1/"
        self.entetes = {"apikey": cle, "Content-Type": "application/json"}
        # Les anciennes clés service_role sont des jetons JWT qu'il faut aussi
        # présenter en « Authorization » ; les nouvelles (sb_secret_…) non.
        if cle.startswith("eyJ"):
            self.entetes["Authorization"] = f"Bearer {cle}"

    def lire(self, table, colonnes="*"):
        r = requests.get(self.racine + table, headers=self.entetes,
                         params={"select": colonnes}, timeout=30)
        r.raise_for_status()
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
        r.raise_for_status()
        return bool(r.json())

    def annuler_envoi(self, espace_id, jour, sorte):
        r = requests.delete(self.racine + "push_envois", headers=self.entetes, params={
            "espace_id": f"eq.{espace_id}", "jour": f"eq.{jour.isoformat()}",
            "sorte": f"eq.{sorte}"}, timeout=30)
        r.raise_for_status()

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
    titre = "Anniversaire aujourd’hui" if not lignes[0].startswith("🎁") else "Cadeau à prévoir"
    if len(lignes) > 1:
        titre = "Skye · rappels du jour"
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
    base = Base(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    cle_privee = os.environ["VAPID_PRIVATE_KEY"]
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

    echecs = 0
    for espace in espaces:
        abonnes = [a for a in abonnements if a["espace_id"] == espace["id"]]
        if not abonnes:
            continue
        dates = dates_de_l_espace(
            espace,
            [m for m in membres if m["espace_id"] == espace["id"]],
            [a for a in anniversaires if a["espace_id"] == espace["id"]])

        a_envoyer = []
        for abonnement in abonnes:
            lignes = lignes_pour(abonnement["membre_id"], dates, aujourdhui)
            if lignes:
                a_envoyer.append((abonnement, message(lignes, aujourdhui)))
        if not a_envoyer:
            continue

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
