# 01 — Cahier des charges fonctionnel

Identifiants : `SA-*` (Super Admin), `TN-*` (compte, sécurité et branding du tenant), `OP-*` (opérationnel), `PC-*` (portail client), `TR-*` (transverse).
Priorités : **M** = indispensable en S12, **S** = souhaitable en S12, **P2** = après la mise en production.
Source : prompt initial (marqué ◆) + compléments issus de l'analyse 00 (marqués ✚).

## 1. Acteurs et espaces
| Acteur | Espace | Description |
|---|---|---|
| Super Admin ✚ | `admin.` | Propriétaire de la plateforme |
| Opérateur plateforme ✚ | `admin.` | Rôles `FINANCE`, `SUPPORT`, `READ_ONLY` |
| Propriétaire tenant ✚ | `{slug}.app.` | Titulaire de l'abonnement, tous les droits |
| Staff ◆ | `{slug}.app.` | Admin, Manager, Front Desk, Housekeeping, Restaurant, Spa, Maintenance (+ Caissier, Comptable ✚) |
| Client ◆ | `{slug}.` (portail) | Client de l'hôtel, compte propre au tenant |

## 2. Espace Super Admin ✚
- **SA-01 (M)** — Tableau de bord : MRR, ARR, tenants par statut, conversions d'essai, encaissements du mois par mode, échéances et impayés, churn.
- **SA-10 (M)** — Plans : CRUD (code, nom, description, ordre, visible, actif). Plans par défaut : Standard, Medium, Premium.
- **SA-11 (M)** — Tarifs paramétrables par plan, cycle (mensuel, trimestriel, annuel) et devise. Ils sont versionnés et sans effet rétroactif.
- **SA-12 (M)** — Essai paramétrable par plan (jours ; 0 = aucun) et prolongation manuelle.
- **SA-13 (M)** — Quotas par plan : établissements, chambres et unités, utilisateurs, stockage, SMS par mois.
- **SA-14 (M)** — Fonctionnalités activées par plan (matrice du doc 02).
- **SA-15 (S)** — Surcharges par tenant : quota ou fonctionnalité offerts, remise, avec date de fin.
- **SA-20 (M)** — Tenants : liste et recherche ; fiche (coordonnées, plan, statut, consommation des quotas, factures, paiements, journal, notes, étiquettes).
- **SA-21 (M)** — Création manuelle d'un tenant ou validation d'une inscription en libre-service.
- **SA-22 (M)** — Changement de plan : montée immédiate au prorata, descente à l'échéance avec contrôle des quotas.
- **SA-24 (M)** — Suspendre, réactiver ou résilier un tenant, avec motif obligatoire.
- **SA-25 (S)** — Accès « en tant que » le tenant pour le support : 30 minutes, motif, bandeau visible, tracé des deux côtés, désactivable par le tenant.
- **SA-26 (S)** — Export complet des données d'un tenant, puis purge planifiée.
- **SA-30 (M)** — Factures d'abonnement automatiques (souscription, renouvellement, prorata), numérotées `PLT-AAAA-000001`, en PDF.
- **SA-31 (M)** — **Enregistrement d'un paiement** : tenant, montant, devise, date, **mode ∈ {MIXX, MOOV_MONEY, CASH, CARD}**, **référence facultative**, pièce jointe, note, imputation sur les factures (automatique sur la plus ancienne, modifiable).
- **SA-32 (M)** — Contrôles : montant > 0, référence unique par mode, date ≤ aujourd'hui, alerte de doublon.
- **SA-33 (M)** — Effets d'un paiement : factures soldées, abonnement prolongé ou réactivé, **reçu PDF** envoyé par e-mail.
- **SA-34 (M)** — Annulation d'un paiement par contre-passation avec motif (jamais de suppression).
- **SA-35 (S)** — Double validation paramétrable : saisie par l'opérateur `FINANCE`, validation par un autre utilisateur.
- **SA-36 (S)** — File des **déclarations de paiement** des tenants, à valider ou rejeter.
- **SA-37 (M)** — Relances automatiques par e-mail, SMS et bandeau (doc 02 §5).
- **SA-38 (M)** — Rapports : encaissements par mode et période, balance âgée, export CSV ou Excel.
- **SA-39 (M)** — Paramètres : identité de facturation, instructions de paiement (numéros marchands Mixx et Moov), durée de grâce, délai de purge, modèles d'e-mails et de SMS.
- **SA-40 (M)** — Utilisateurs plateforme, rôles, 2FA obligatoire.
- **SA-41 (M)** — Journal d'audit de la plateforme.
- **SA-42 (S)** — Annonces (bandeau) et maintenance planifiée.
- **SA-44 (S)** — Tickets de support.

## 3. Tenant — compte, sécurité, branding ✚
- **TN-01 (M)** — Inscription en libre-service : hôtel, slug, propriétaire, pays, plan → essai démarré, vérification de l'e-mail.
- **TN-02 (M)** — Assistant de démarrage : établissement → chambres → tarifs → taxes → services (spa, restaurant) → utilisateurs → branding.
- **TN-03 (S)** — Données de démonstration effaçables.
- **TN-10 (M)** — Utilisateurs : invitation, activation et désactivation, affectation aux établissements et départements.
- **TN-11 (M)** — **Rôles personnalisés** à permissions fines `module.action` par établissement (rôles système clonables).
- **TN-12 (M)** — Politique de mot de passe : longueur, complexité, expiration, historique.
- **TN-13 (M)** — **2FA** TOTP (codes de secours ; OTP par e-mail en repli), facultative ou obligatoire par rôle.
- **TN-14 (M)** — Sessions : délai d'inactivité, nombre maximal, liste et révocation.
- **TN-15 (S)** — Liste blanche d'IP et plages horaires par rôle (Medium et plus).
- **TN-16 (M)** — Verrouillage après N échecs ; alerte en cas de connexion inhabituelle.
- **TN-17 (M)** — Journal d'audit (qui, quoi, quand, avant et après, IP), consultable et exportable.
- **TN-18 (S)** — Autoriser ou refuser l'accès « en tant que » par le support.
- **TN-20 (M)** — Branding : logos clair et sombre, favicon, couleurs primaire et secondaire, appliqués aux tokens Ant Design **et** au portail client.
- **TN-21 (M)** — Documents brandés : factures, reçus, fiches de police, confirmations (coordonnées, NIF, RCCM, mentions, cachet).
- **TN-22 (M)** — Modèles d'e-mails et de SMS personnalisés, nom d'expéditeur.
- **TN-23 (M)** — Sous-domaine ; **domaine personnalisé** (Premium) avec TLS automatique.
- **TN-24 (S)** — Page de connexion et page d'accueil du portail personnalisées (images, textes, galerie).
- **TN-25 (M)** — Langue, devise, fuseau et formats par défaut.
- **TN-30 (M)** — Abonnement : plan, quotas consommés, échéance, factures et reçus.
- **TN-31 (S)** — **Déclarer un paiement** : mode, montant, référence, capture.
- **TN-32 (M)** — Demande de changement de plan.
- **TN-33 (M)** — Bandeaux : essai J-x, échéance proche, impayé, suspendu (lecture seule).
- **TN-34 (M)** — Instructions de paiement affichées.

## 4. Opérationnel

### 4.1 Paramétrage ✚
- **OP-01 (M)** — Établissements (multi selon le plan), bâtiments, étages, zones (piscine, plage…).
- **OP-02 (M)** — Types d'unités (chambre, suite, villa, bungalow) : capacité, lits, équipements, photos, description FR et EN.
- **OP-03 (M)** — Unités : numéro, type, étage, caractéristiques, statut.
- **OP-04 (M)** — **Plans tarifaires**, **saisons**, prix par jour de la semaine, adulte et enfant supplémentaires, formule repas (RO, BB, HB, FB), séjour minimum, tarifs entreprise.
- **OP-05 (M)** — **Taxes** : TVA (%), taxe de séjour (fixe par personne et par nuit, ou %), prix TTC ou HT.
- **OP-06 (M)** — Politiques d'annulation, de modification et d'acompte (règles JSON : délai, pénalité).
- **OP-07 (M)** — Produits et extras (minibar, blanchisserie, transfert), catégories, départements de chiffre d'affaires.
- **OP-08 (M)** — Numérotation sans trou par établissement (réservations, factures, reçus).

### 4.2 Réservations ◆ + ✚
- **OP-10 (M)** ◆ — **Calendrier de disponibilités en temps réel** (FullCalendar resource timeline), glisser-déposer, couleurs par statut, mise à jour par Socket.io.
- **OP-11 (M)** ◆ — Recherche de disponibilités avec calcul du prix (tarifs, saisons, taxes, remises).
- **OP-12 (M)** ◆ — Réservation **multi-services** dans un seul dossier : unités, rendez-vous spa, tables de restaurant, activités.
- **OP-13 (M)** ◆ — Cycle `PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT → COMPLETED` (+ `CANCELLED`, `NO_SHOW`). `PENDING` a une date d'expiration et `COMPLETED` intervient une fois le folio soldé.
- **OP-14 (M)** ◆ — Modification et annulation avec **application de la politique** (pénalité postée sur le folio).
- **OP-15 (M)** ◆ — **Anti-surbooking** garanti en base (doc 03 §5) et **liste d'attente** : à la libération d'une unité, le premier client compatible est notifié et dispose d'un délai pour confirmer.
- **OP-16 (M)** ◆ — Confirmations et rappels automatiques (e-mail ; SMS et WhatsApp ✚), J-3 et J-1.
- **OP-17 (S)** ✚ — Groupes : bloc d'unités, rooming list, folio maître.
- **OP-18 (S)** ✚ — Blocage d'unités (maintenance, hors service).
- **OP-19 (P2)** — Channel manager OTA.

### 4.3 Réception ◆ + ✚
- **OP-20 (M)** — Listes du jour : arrivées, départs, présents ; actions rapides (nouvelle réservation, check-in, check-out).
- **OP-21 (M)** ✚ — Check-in avec **fiche de police** (pièce, nationalité, naissance, profession, provenance, destination, motif), signature, attribution de l'unité.
- **OP-22 (M)** — Walk-in, changement d'unité, prolongation, départ anticipé.
- **OP-23 (M)** — Check-out : folio soldé ou transféré sur un compte débiteur, facture.
- **OP-24 (M)** ✚ — **Audit de nuit** : contrôles, report des nuitées, clôture de la date d'exploitation, rapports du jour.

### 4.4 CRM ◆
- **OP-30 (M)** — Profil client : identité, contacts, pièces chiffrées, préférences (oreiller, régime, allergies), historique des séjours, soins et commandes, chiffre d'affaires cumulé.
- **OP-31 (M)** — **Fidélité** : registre de points (gain par XOF dépensé et par département, utilisation, expiration, ajustement manuel tracé), **paliers** (ex. Silver, Gold, Platinum) avec seuils, remises et avantages paramétrables, statut VIP.
- **OP-32 (M)** — Journal des communications : e-mails envoyés, notes, demandes spéciales, appels.
- **OP-33 (M)** — Données personnelles : consentements (marketing), export, anonymisation, durée de conservation ; fusion des doublons ; liste noire avec alerte.
- **OP-34 (S)** — Sociétés : conditions, tarif négocié, compte débiteur.

### 4.5 Staff et RH ◆
- **OP-40 (M)** — Employés : fiche, département, poste, contrat, contact d'urgence, lien éventuel avec un compte utilisateur.
- **OP-41 (M)** — **Planning des shifts** : modèles de shifts, planning hebdomadaire par département, détection des conflits et des heures maximales, publication et notification.
- **OP-42 (M)** — **Pointage** : arrivée et départ (bouton ou PIN sur tablette), écarts par rapport au planning, export pour la paie.
- **OP-43 (M)** — **Tâches** : création, affectation, échéance, priorité, statut, preuve (photo), commentaires.
- **OP-44 (M)** — **Messagerie interne** : conversations 1-1 et par département, temps réel (Socket.io), pièces jointes ; centre de notifications (cloche) avec préférences.
- **OP-45 (S)** — Congés et absences.

### 4.6 Restaurant ◆
- **OP-50 (M)** — Points de vente (restaurant, bar, room service) ; **plan de salle** éditable (tables, zones, capacité) et statuts en temps réel (libre, réservée, occupée, à nettoyer).
- **OP-51 (M)** — Menu : catégories, articles, prix, TVA, **étiquettes régime et allergènes**, photos, plats du jour (période), disponibilité **liée au stock** (épuisé automatiquement).
- **OP-52 (M)** — Commandes : table, chambre ou à emporter ; envoi en cuisine (écran ou ticket 80 mm) ; statuts ; **imputation sur la chambre** (folio) ou règlement immédiat ; division de l'addition.
- **OP-53 (M)** — Réservations de table : créneaux et capacité, **priorité aux résidents** (ouverture anticipée ou quota réservé).
- **OP-54 (S)** — Remises, offerts et annulations avec permission et trace.

### 4.7 Spa et activités ◆
- **OP-60 (M)** — Catalogue de soins : durée, temps de préparation, prix, ressources requises (praticien qualifié, cabine).
- **OP-61 (M)** — Disponibilités des praticiens (lien avec les shifts), cabines et équipements.
- **OP-62 (M)** — Rendez-vous : vérification de la disponibilité du praticien **et** de la cabine, préférences du client (genre du praticien, pression), imputation sur la chambre, rappels.
- **OP-63 (M)** — **Forfaits** (ex. 2 nuits + 1 massage) : composants, prix global, répartition du chiffre d'affaires par département.
- **OP-64 (M)** — Historique des soins par client (notes du praticien, contre-indications ; accès restreint).
- **OP-65 (M)** ✚ — **Activités** (excursions, sports, kids club) : créneaux, capacité, guide, prix par personne, réservation.

### 4.8 Stocks ◆
- **OP-70 (M)** — Articles, unités, magasins par département (housekeeping, restaurant, spa, maintenance, minibar).
- **OP-71 (M)** — Mouvements : entrée, sortie, transfert, perte ; valorisation au coût moyen pondéré.
- **OP-72 (M)** — **Consommation liée aux services** : fiches techniques (recette ou soin → articles) avec décrément automatique.
- **OP-73 (M)** — Seuils minimum et de réapprovisionnement, **alertes** de stock bas (temps réel + e-mail).
- **OP-74 (M)** — Fournisseurs, **bons de commande** (brouillon → envoyé → reçu partiel ou total), réception mettant à jour le stock.
- **OP-75 (M)** — **Suggestions de réapprovisionnement** (consommation moyenne × délai fournisseur + stock de sécurité).
- **OP-76 (S)** — Inventaires physiques et écarts.

### 4.9 Maintenance et housekeeping ◆ + ✚
- **OP-80 (M)** — Demandes (staff, client via le portail, déclencheurs automatiques) : unité ou équipement, description, photo, **priorité** (urgent, haute, normale, basse).
- **OP-81 (M)** — Bons de travail : affectation, délai de traitement par priorité, pièces utilisées (sortie de stock), temps passé, clôture.
- **OP-82 (M)** — Statut des unités : disponible, occupée, en maintenance, hors service ; **historique par unité et équipement**.
- **OP-83 (M)** — **Maintenance préventive** : plans récurrents (tous les N jours, mois ou nuitées) générant des bons de travail (job).
- **OP-84 (M)** ✚ — **Housekeeping** : statuts propre, sale, inspecté et hors service, affectation des chambres, vue mobile en un tap, minibar posté sur le folio, objets trouvés.

### 4.10 Facturation ◆ + ✚
- **OP-90 (M)** — **Folio unifié** par séjour ou dossier : nuitées (postées par l'audit de nuit), restaurant, spa, activités, minibar, extras, taxes, remises. Corrections par contre-passation uniquement ; plusieurs folios possibles (séparation des charges).
- **OP-91 (M)** — **Encaissements** : `CASH`, `CARD`, `BANK_TRANSFER`, `MIXX`, `MOOV_MONEY`, `LOYALTY_POINTS`, `CITY_LEDGER`, avec **référence facultative**, acomptes, paiements partiels, idempotence.
- **OP-92 (M)** — Factures et **avoirs** PDF brandés et numérotés ; envoi par e-mail ; jamais de modification après émission.
- **OP-93 (M)** ✚ — **Sessions de caisse** : fonds, encaissements, sorties, clôture avec comptage et écart.
- **OP-94 (M)** — Taxes calculées par ligne ; rapport des taxes collectées (TVA, taxe de séjour).
- **OP-95 (M)** — Rapports de chiffre d'affaires par département, période et type de service ; encaissements par mode ; main courante.
- **OP-96 (S)** — Comptes débiteurs (entreprises) : relevés, règlements.

### 4.11 Tableaux de bord et analytique ◆
- **OP-100 (M)** — Temps réel : occupation, arrivées et départs, chiffre d'affaires du jour et du mois, **TO, ADR, RevPAR**.
- **OP-101 (M)** — KPI par département : couverts et ticket moyen (restaurant), rendez-vous et taux d'occupation des praticiens (spa), participants (activités), bons de travail ouverts et délai moyen (maintenance).
- **OP-102 (M)** — **Prévisions** : occupation et chiffre d'affaires attendus sur 30, 60 et 90 jours (réservations enregistrées + tendance N-1).
- **OP-103 (M)** — Performance du staff : tâches réalisées, délais, ponctualité (pointage), chiffre d'affaires par serveur et praticien.
- **OP-104 (M)** — Exports PDF, Excel et CSV ; envoi programmé (Premium).

## 5. Portail client ◆
- **PC-01 (M)** — Site public brandé du tenant (FR et EN) : présentation, unités, spa, restaurant, activités.
- **PC-02 (M)** — Parcours de réservation : **recherche → sélection (unité et services) → coordonnées → confirmation → e-mail**. Statut `PENDING`, avec un acompte facultatif **déclaré** (Mixx ou Moov Money + référence) ou un paiement à l'hôtel (H3).
- **PC-03 (M)** — Compte client (e-mail et mot de passe ou lien magique) : séjours à venir et passés, modification et annulation selon la politique.
- **PC-04 (M)** — Pendant le séjour : demandes de room service, d'équipements et de maintenance ; réservation de spa, de table et d'activités.
- **PC-05 (M)** — Factures, paiements, solde de points de fidélité, palier.
- **PC-06 (M)** — Consentements, export et suppression des données.
- **PC-07 (M)** — Mobile d'abord, **WCAG 2.1 AA**, Lighthouse ≥ 90 (performance et accessibilité).

## 6. Transverse
- **TR-01 (M)** — Isolation stricte entre tenants, testée automatiquement sur chaque route et chaque événement Socket.io.
- **TR-02 (M)** — i18n FR et EN (back-office et portail), XOF par défaut, fuseau par établissement.
- **TR-03 (M)** — Back-office : mode clair et sombre, barre latérale par module, cloche de notifications, actions rapides, couleurs de statut cohérentes ; responsive tablette.
- **TR-04 (M)** — Performance : p95 API < 300 ms ; calendrier de 150 unités sur 31 jours < 1 s ; bundle initial du portail < 250 Ko gzip.
- **TR-05 (M)** — Disponibilité de 99,5 %, sauvegardes quotidiennes chiffrées (30 jours), RPO 24 h, RTO 4 h.
- **TR-06 (M)** — OWASP ASVS niveau 2, HTTPS forcé, Helmet, rate limiting, assainissement des entrées.
- **TR-07 (M)** — Documentation Swagger générée depuis les schémas Zod.
- **TR-08 (M)** — Interface `PaymentProvider` (seule implémentation en v1 : `manual`).
- **TR-09 (M)** — Impression des tickets 80 mm et des documents A4.
- **TR-10 (M)** — Notifications SMS et WhatsApp via des adapters interchangeables.
