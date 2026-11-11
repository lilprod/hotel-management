# 01 — Cahier des charges fonctionnel

Identifiants des exigences : `SA-*` (Super Admin), `TN-*` (tenant / plateforme côté hôtel), `OP-*` (opérationnel), `TR-*` (transverse). Priorité : **M** = indispensable v1, **S** = souhaitable v1, **P2** = phase 2.

## 1. Acteurs
| Acteur | Espace | Description |
|---|---|---|
| Super Admin | `admin.domaine.com` | Propriétaire de la plateforme, avec accès total |
| Opérateur plateforme | `admin.` | Support ou comptable plateforme, avec rôles restreints (finance, support, lecture) |
| Propriétaire tenant | `{slug}.` | Créateur du compte hôtel, titulaire de l'abonnement |
| Staff tenant | `{slug}.` | Directeur, réceptionniste, caissier, gouvernante, femme de chambre, technicien, serveur, comptable… (rôles paramétrables) |
| Client final | Widget / e-mail | Client de l'hôtel (réservation en ligne en P2) |

## 2. Espace Super Admin

### 2.1 Tableau de bord — SA-01 (M)
MRR, ARR, nombre de tenants par statut (essai, actif, impayé, suspendu, résilié), conversions d'essai, encaissements du mois **par mode de paiement**, échéances à venir et impayés, *churn*.

### 2.2 Gestion des plans — SA-10 à SA-15
- SA-10 (M) : CRUD des plans (code, nom, description, ordre, visible, actif). Plans par défaut : **Standard**, **Medium**, **Premium**.
- SA-11 (M) : **tarifs paramétrables** par plan et par cycle (mensuel, trimestriel, annuel) et par devise ; historique des tarifs (versionné, sans effet rétroactif sur les abonnements en cours sauf choix explicite).
- SA-12 (M) : **période d'essai** paramétrable par plan (en jours, 0 = pas d'essai), plan d'essai par défaut, essai sans carte.
- SA-13 (M) : **quotas** par plan : établissements, chambres, utilisateurs, stockage (Mo), SMS par mois.
- SA-14 (M) : **fonctionnalités** par plan (*feature flags*) : voir la matrice du doc 02.
- SA-15 (S) : surcharges par tenant (quota ou fonctionnalité accordés exceptionnellement, remise commerciale en % ou montant, avec date de fin).

### 2.3 Gestion des tenants — SA-20 à SA-29
- SA-20 (M) : liste, filtres et recherche ; fiche tenant (coordonnées, statut, plan, utilisation des quotas, historique de facturation, journal).
- SA-21 (M) : créer un tenant manuellement (vente assistée) ou valider une inscription en libre-service.
- SA-22 (M) : changer de plan (*upgrade* immédiat avec prorata, *downgrade* à l'échéance avec contrôle des quotas).
- SA-23 (M) : prolonger un essai, offrir des jours.
- SA-24 (M) : suspendre, réactiver ou résilier, avec motif obligatoire.
- SA-25 (S) : **impersonation** limitée dans le temps (30 min), avec motif obligatoire, bandeau visible, tracée dans l'audit du tenant **et** de la plateforme, et désactivable par le tenant (paramètre de sécurité).
- SA-26 (S) : export des données d'un tenant (ZIP JSON + CSV), purge planifiée.
- SA-27 (M) : note interne et étiquettes sur un tenant.

### 2.4 Facturation et paiements manuels — SA-30 à SA-39
- SA-30 (M) : **factures d'abonnement** générées automatiquement à chaque échéance (et à la souscription), numérotation séquentielle sans trou `PLT-AAAA-000001`, PDF.
- SA-31 (M) : **enregistrer un paiement** : tenant, montant, devise, date de paiement, **mode** ∈ {`MIXX`, `MOOV_MONEY`, `CASH`, `CARD`}, **référence (facultative)**, pièce jointe (capture, reçu), note, factures imputées (affectation automatique à la plus ancienne facture impayée, modifiable).
- SA-32 (M) : contrôles : montant > 0 ; **référence unique par mode** lorsqu'elle est renseignée (alerte de doublon) ; date ≤ aujourd'hui.
- SA-33 (M) : effets d'un paiement : facture(s) → `PAID` / `PARTIALLY_PAID`, abonnement prolongé ou réactivé, **reçu PDF** envoyé par e-mail au tenant.
- SA-34 (M) : **annulation** d'un paiement par contre-passation (motif obligatoire), jamais de suppression physique.
- SA-35 (S) : **double validation** paramétrable : un paiement saisi par un opérateur « finance » doit être validé par un autre utilisateur.
- SA-36 (S) : file des **déclarations de paiement** envoyées par les tenants (TN-31) : valider (cela crée le paiement) ou rejeter (avec motif).
- SA-37 (M) : relances automatiques paramétrables (J-7, J-3, J0, J+3, J+7) par e-mail, SMS et bandeau.
- SA-38 (M) : rapports : encaissements par période et par mode, balance âgée des impayés, export CSV/Excel.
- SA-39 (M) : paramètres de facturation : raison sociale, NIF/RCCM, adresse, TVA applicable, mentions légales, logo des factures plateforme, durée de grâce, délai de purge.

### 2.5 Administration plateforme — SA-40 à SA-49
- SA-40 (M) : utilisateurs plateforme et rôles (`SUPER_ADMIN`, `FINANCE`, `SUPPORT`, `READ_ONLY`) ; **2FA obligatoire**.
- SA-41 (M) : journal d'audit plateforme (immuable).
- SA-42 (S) : annonces globales ou ciblées (bandeau dans l'espace tenant), maintenance planifiée.
- SA-43 (S) : modèles d'e-mails et de SMS (variables).
- SA-44 (S) : tickets de support (le tenant ouvre, la plateforme répond).
- SA-45 (M) : paramètres globaux : devises, langues, taux de TVA par défaut, fournisseurs SMS et e-mail.
- SA-46 (S) : santé du système (files d'attente, erreurs, dernières sauvegardes).

## 3. Espace tenant — plateforme (compte, sécurité, branding)

### 3.1 Inscription et onboarding — TN-01 à TN-05
- TN-01 (M) : inscription en libre-service (nom de l'hôtel, slug, propriétaire, téléphone, e-mail, pays, choix du plan) → essai démarré, e-mail de vérification.
- TN-02 (M) : **assistant d'onboarding** : établissement → types de chambres → chambres → tarifs → taxes → utilisateurs → branding.
- TN-03 (S) : données de démonstration facultatives (effaçables).

### 3.2 Abonnement — TN-30 à TN-35
- TN-30 (M) : voir le plan, les quotas utilisés, la date d'échéance, les factures et les reçus (PDF).
- TN-31 (S) : **déclarer un paiement** (mode, montant, référence, capture) → en attente de validation par le Super Admin.
- TN-32 (M) : demander un changement de plan (*upgrade* : facture de prorata générée).
- TN-33 (M) : bandeaux d'état : essai J-x, échéance proche, impayé, **suspendu (lecture seule)**.
- TN-34 (M) : instructions de paiement affichées (numéros Mixx et Moov marchand, coordonnées), paramétrées par le Super Admin.

### 3.3 Sécurité (gérée par le tenant) — TN-10 à TN-19
- TN-10 (M) : utilisateurs : invitation par e-mail ou SMS, activation, désactivation, réinitialisation, affectation aux établissements.
- TN-11 (M) : **rôles et permissions personnalisables** (modèle de rôles prédéfinis + création de rôles ; permissions fines par module et par action, voir doc 05).
- TN-12 (M) : **politique de mot de passe** : longueur minimale, complexité, expiration, historique.
- TN-13 (M) : **2FA** (TOTP ; OTP par SMS ou e-mail en secours), facultative ou obligatoire par rôle.
- TN-14 (M) : **sessions** : durée d'inactivité, sessions simultanées max, liste des sessions actives et révocation.
- TN-15 (S) : **restriction IP** (liste blanche) et plages horaires par rôle.
- TN-16 (M) : verrouillage après N échecs de connexion, alertes de connexion inhabituelle.
- TN-17 (M) : **journal d'audit tenant** consultable et exportable (qui, quoi, quand, avant/après, IP).
- TN-18 (S) : autoriser ou refuser l'impersonation par le support.
- TN-19 (P2) : SSO (Google, Microsoft) pour Premium ; clés API (Premium).

### 3.4 Branding — TN-20 à TN-25
- TN-20 (M) : logo (clair/sombre), favicon, **couleurs primaire et secondaire** (thème appliqué à l'interface).
- TN-21 (M) : en-têtes et pieds de **documents** (factures, reçus, fiches de police, confirmations) : coordonnées, NIF/RCCM, mentions, signature et cachet.
- TN-22 (M) : modèles d'e-mails et de SMS personnalisés (nom d'expéditeur).
- TN-23 (M) : sous-domaine `{slug}` ; **domaine personnalisé** (Premium) avec TLS automatique.
- TN-24 (S) : page de connexion personnalisée (image de fond, message).
- TN-25 (M) : langue et devise par défaut, format de date, fuseau horaire.

## 4. Espace tenant — opérationnel hôtelier

### 4.1 Paramétrage — OP-01 à OP-09
- OP-01 (M) : établissements (multi selon le plan), bâtiments, étages.
- OP-02 (M) : types de chambres (capacité adultes/enfants, lits, superficie, équipements, photos).
- OP-03 (M) : chambres (numéro, type, étage, statut, caractéristiques).
- OP-04 (M) : **plans tarifaires** (BAR, entreprise, long séjour…), **saisons**, tarifs par jour de la semaine, enfant, lit supplémentaire, petit-déjeuner/pension (RO, BB, HB, FB).
- OP-05 (M) : **taxes** : TVA (%), taxe de séjour (fixe par personne/nuit ou %), inclusion ou non dans le prix.
- OP-06 (M) : produits et services (extras, blanchisserie, transfert…), catégories.
- OP-07 (M) : politiques d'annulation, d'acompte et d'heures de check-in/out.
- OP-08 (M) : sources et segments (direct, téléphone, walk-in, agence, Booking…).
- OP-09 (M) : séquences de numérotation (factures, reçus, réservations), sans trou, par établissement.

### 4.2 Réservations et planning — OP-10 à OP-19
- OP-10 (M) : **planning** (vue chronologique par chambre, glisser-déposer, codes couleur par statut).
- OP-11 (M) : recherche de disponibilités (dates, personnes, type) avec calcul du tarif.
- OP-12 (M) : création de réservation : client(s), chambres (plusieurs), tarif, remises, notes, source, **acompte**.
- OP-13 (M) : statuts `OPTION` (avec date d'expiration) → `CONFIRMED` → `CHECKED_IN` → `CHECKED_OUT` ; `CANCELLED`, `NO_SHOW`.
- OP-14 (M) : modification (dates, chambre), annulation avec application de la politique.
- OP-15 (S) : **réservations de groupe** (bloc de chambres, rooming list, facturation maître).
- OP-16 (M) : prévention du **double booking** (contrainte en base, voir doc 03).
- OP-17 (S) : blocage de chambres (maintenance, hors service).
- OP-18 (M) : envoi de la confirmation (e-mail, SMS, WhatsApp).
- OP-19 (P2) : moteur de réservation public (widget) et channel manager.

### 4.3 Réception — OP-20 à OP-29
- OP-20 (M) : arrivées, départs et présents du jour.
- OP-21 (M) : **check-in** : vérification d'identité, **fiche de police** (type et numéro de pièce, nationalité, date et lieu de naissance, profession, provenance, destination, motif), signature, attribution de la chambre.
- OP-22 (M) : walk-in (réservation et check-in en une étape).
- OP-23 (M) : changement de chambre, prolongation, départ anticipé.
- OP-24 (M) : **check-out** : solde du folio obligatoire (ou transfert vers un compte débiteur entreprise), facture.
- OP-25 (S) : registre de police imprimable et exportable par période.

### 4.4 Folio, facturation et caisse — OP-30 à OP-39
- OP-30 (M) : **folio** par séjour (plusieurs folios possibles) : nuitées postées automatiquement, extras, POS, taxes, remises (avec permission), corrections par contre-passation.
- OP-31 (M) : **encaissements** : modes `MIXX`, `MOOV_MONEY`, `CASH`, `CARD`, `BANK_TRANSFER`, `CITY_LEDGER` ; référence facultative ; paiements partiels ; acomptes.
- OP-32 (M) : **factures et reçus** numérotés, PDF aux couleurs du tenant ; **avoirs** (jamais de modification d'une facture émise).
- OP-33 (M) : **sessions de caisse** : ouverture (fonds), encaissements, sorties de caisse, clôture (comptage, écart), par utilisateur.
- OP-34 (S) : comptes débiteurs entreprises (*city ledger*), relevés, règlements.
- OP-35 (M) : **audit de nuit** : contrôle des arrivées et départs non traités, report des nuitées, clôture de la date d'exploitation, rapports du jour.

### 4.5 Housekeeping et maintenance — OP-40 à OP-49
- OP-40 (M) : statuts des chambres `CLEAN`, `DIRTY`, `INSPECTED`, `OUT_OF_ORDER`, `OUT_OF_SERVICE` ; occupé ou libre.
- OP-41 (M) : affectation des chambres au personnel, vue mobile, changement de statut en un tap.
- OP-42 (S) : signalement d'objets trouvés et de consommations minibar (postées sur le folio).
- OP-43 (M) : **tickets de maintenance** (chambre/équipement, priorité, photo, statut, technicien), avec option de bloquer la chambre.

### 4.6 Point de vente (restaurant / bar) — OP-50 à OP-55 (Medium+)
- OP-50 (M) : points de vente, carte (catégories, articles, prix, TVA).
- OP-51 (M) : prise de commande (table/chambre), ticket, envoi en cuisine (impression).
- OP-52 (M) : règlement immédiat ou **imputation sur la chambre** (folio).
- OP-53 (S) : remises, offerts (avec permission), annulations tracées.

### 4.7 Stocks — OP-60 à OP-65 (Medium+)
- OP-60 (M) : articles stockés, unités, magasins (bar, cuisine, minibar, économat).
- OP-61 (M) : mouvements (entrée, sortie, transfert, perte), décrément automatique depuis le POS (fiche technique simple).
- OP-62 (M) : inventaire, valorisation (CMP), alertes de seuil.
- OP-63 (S) : fournisseurs, bons de commande.

### 4.8 Clients (CRM) — OP-70 à OP-74
- OP-70 (M) : fiche client (identité, contacts, pièces, préférences, historique des séjours, CA).
- OP-71 (M) : sociétés (conditions, tarif négocié, compte débiteur).
- OP-72 (S) : étiquettes VIP et liste noire (avec alerte à la réservation), fusion de doublons.

### 4.9 Rapports — OP-80 à OP-89
- OP-80 (M) : tableau de bord : occupation du jour, arrivées et départs, CA du jour/mois, **TO %, ADR, RevPAR**.
- OP-81 (M) : main courante, état de caisse, **encaissements par mode**, CA par département, taxes collectées (TVA, taxe de séjour).
- OP-82 (M) : rapports d'occupation (prévisions), sources et segments, nationalités.
- OP-83 (S) : export CSV, Excel et PDF ; envoi programmé par e-mail (Premium).

## 5. Exigences transverses — TR
- TR-01 (M) : **isolation stricte** des données entre tenants (voir doc 03), testée automatiquement.
- TR-02 (M) : i18n FR/EN, devise XOF par défaut (0 décimale), multi-devise d'affichage.
- TR-03 (M) : responsive, PWA, utilisable en 3G ; page initiale < 300 Ko gzip.
- TR-04 (M) : performance : p95 API < 300 ms ; planning de 100 chambres sur 31 jours < 1 s.
- TR-05 (M) : disponibilité de 99,5 %, sauvegardes quotidiennes chiffrées (rétention de 30 jours), RPO 24 h, RTO 4 h.
- TR-06 (M) : sécurité OWASP ASVS niveau 2 ; chiffrement en transit (TLS 1.2+) et au repos pour les pièces d'identité.
- TR-07 (M) : conformité à la protection des données (loi togolaise 2019-014, APDCP) : consentement, export, droit à l'oubli, durée de conservation des fiches de police paramétrable.
- TR-08 (M) : architecture paiement extensible (`PaymentProvider`), pour brancher un agrégateur (CinetPay, PayDunya, FedaPay, Semoa…) sans refonte.
- TR-09 (M) : impressions thermiques 80 mm (tickets) et A4 (factures).
- TR-10 (S) : accessibilité WCAG 2.1 AA sur les écrans principaux.
