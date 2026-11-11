# Prompt formalisé — SaaS de gestion de complexes hôteliers et touristiques

> Version consolidée du prompt initial, transformée en SaaS multi-tenant. Elle sert de **brief maître** à l'orchestrateur. Les détails sont dans les documents `docs/01` à `docs/07`. Les sous-agents ne reçoivent pas ce prompt : ils reçoivent une fiche de mission (doc 06 §6).

## 1. Objectif
Construire une **plateforme SaaS multi-tenant** de gestion de complexes hôteliers et touristiques (hébergement, restaurant, spa, activités), prête pour la production en **12 semaines**. Elle comporte trois espaces :
1. **Super Admin** (`admin.domaine.com`) : l'éditeur gère les tenants, les plans, les tarifs, les essais, la facturation et les **paiements enregistrés manuellement**.
2. **Back-office tenant** (`{slug}.app.domaine.com`) : le personnel de l'hôtel gère **tout l'opérationnel**, sa **sécurité** et son **branding**.
3. **Portail client** (`{slug}.domaine.com` ou domaine personnalisé) : les clients de l'hôtel réservent et suivent leurs séjours, aux couleurs de l'hôtel.

## 1 bis. Pays cible
**Togo** uniquement en v1 : XOF, Africa/Lome, +228, TVA 18 %, taxe de séjour paramétrable, mentions OTR (NIF, RCCM), facture normalisée OTR via un adapter, fiche de police, loi 2019-014 / IPDCP, Mixx by Yas et Moov Money, SYSCOHADA. L'architecture reste multi-pays. Détails et points à confirmer : doc 09.

## 2. Stack imposée (pas d'alternative)
- **Frontend** : React 18 + TypeScript + Vite, Ant Design 5 (thème par tenant via tokens), Zustand, TanStack Query, React Router v6, React Hook Form + Zod, Recharts, FullCalendar (timeline des ressources), i18next (FR/EN).
- **Backend** : Node.js 20 + Express + TypeScript, Zod (validation et génération OpenAPI), Prisma + PostgreSQL 16 (RLS), Redis + **BullMQ** (jobs ; pas de node-cron), **Socket.io** + adapter Redis, Nodemailer (gabarits MJML), Multer en mémoire vers **S3/MinIO**, Winston, Helmet, express-rate-limit, Swagger UI.
- **Infrastructure** : Docker Compose (postgres, redis, minio, mailpit, gotenberg), GitHub Actions, `.env` par environnement.
- **Tests** : Vitest, Supertest, Playwright ; suite d'**isolation inter-tenants** obligatoire.

## 3. Multi-tenancy et SaaS
- Base partagée, `tenant_id` sur toute table métier, **Row-Level Security** et contexte de tenant par requête (AsyncLocalStorage).
- Tenant résolu par le nom d'hôte. Le JWT porte `tid`, et une incohérence entre le jeton et l'hôte est rejetée.
- **Plans** Standard, Medium et Premium : prix paramétrables par cycle (mensuel, trimestriel, annuel), **essai** paramétrable en jours, **quotas** (établissements, chambres, utilisateurs, stockage, SMS) et **fonctionnalités** activées par plan.
- Cycle d'abonnement : `TRIALING → ACTIVE → PAST_DUE → SUSPENDED (lecture seule) → CANCELLED`.
- **Paiements d'abonnement** : saisis par le Super Admin avec montant, date, mode ∈ {Mixx, Moov Money, Espèces, Carte bancaire}, **référence facultative** (unique par mode si renseignée) et pièce jointe. Ils sont imputés aux factures et génèrent un reçu PDF ; on les annule par contre-passation. Le tenant peut **déclarer** un paiement, que le Super Admin valide. Le code prévoit une interface `PaymentProvider` pour un futur intégrateur.

## 4. Espace tenant : sécurité et branding
- **Sécurité** : utilisateurs, rôles système et **rôles personnalisés** à permissions fines par établissement, politique de mot de passe, **2FA TOTP**, sessions (inactivité, nombre maximal, révocation), verrouillage après échecs, liste blanche d'IP, **journal d'audit** consultable, autorisation ou non de l'accès « en tant que » par le support.
- **Branding** : logo, favicon, couleurs (thème Ant Design et portail), en-têtes et pieds des factures, reçus et e-mails, modèles de messages, page de connexion, domaine personnalisé (Premium).

## 5. Modules opérationnels (détail dans le doc 01 §4)
1. **Réservations** : calendrier des disponibilités en temps réel, réservation multi-services (chambre, spa, restaurant, activités), cycle `PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT → COMPLETED` (+ `CANCELLED`, `NO_SHOW`), politiques d'annulation et de modification, liste d'attente, anti-surbooking garanti en base, plans tarifaires et saisons, taxes (TVA, taxe de séjour), groupes, **fiche de police**, **audit de nuit**.
2. **CRM et portail client** : profils, historique, préférences, **fidélité** (registre de points, paliers, avantages), journal des communications, conformité aux règles sur les données personnelles (RGPD et loi togolaise 2019-014). Sur le portail : réservation en ligne, séjours, demandes de services, factures et paiements, déclaration d'acompte par Mobile Money.
3. **Staff et RH** : employés, départements, plannings de shifts, pointage, tâches, messagerie interne et notifications temps réel.
4. **Restaurant** : plan de salle, menu (régimes, allergènes), commandes imputées sur la chambre ou réglées à part, réservations de table (priorité aux résidents), plats du jour, disponibilité liée au stock.
5. **Spa et activités** : catalogue de soins, planning des praticiens et des cabines, rendez-vous, forfaits (spa + hébergement), historique des soins ; activités avec créneaux et capacité.
6. **Stocks** : stocks multi-départements, alertes de seuil, fournisseurs, bons de commande, consommation liée aux services, suggestions de réapprovisionnement.
7. **Maintenance et housekeeping** : demandes et bons de travail (urgent, haute, normale, basse), statuts des chambres, historique, **maintenance préventive** ; housekeeping (propre, sale, inspecté, hors service) en vue mobile.
8. **Facturation** : **folio unifié**, encaissements (Espèces, Carte, Virement, Mixx, Moov Money, Points, Compte débiteur) enregistrés manuellement avec référence, **sessions de caisse**, factures et avoirs PDF numérotés sans trou, taxes, rapports de chiffre d'affaires.
9. **Tableaux de bord** : taux d'occupation, ADR, RevPAR, KPI par département, prévisions basées sur les réservations enregistrées, performance du staff, exports PDF, Excel et CSV.

## 5 bis. Le prompt est un plancher, pas un plafond
- L'architecture doit rester **extensible sans refonte** : registre de modules, feature flags, **add-ons**, paramètres hiérarchiques, **champs personnalisés**, listes paramétrables, moteur de taxes par pays, adapters de paiement, notification, facture fiscale, channel manager et serrures, multi-devise, i18n extensible, API-first et webhooks (doc 08 §1).
- Aucune règle métier codée en dur : statuts de machine à états en enums, tout le reste en paramètres.
- Compléments obligatoires en v1 (doc 08) : **import de données**, encaissement **multi-devise**, **export comptable SYSCOHADA** et clôture mensuelle, états de TVA et de taxe de séjour, minibar, objets trouvés, alertes allergies et liste noire, parcours e-mail automatisés, reporting consolidé multi-établissements, matériel de caisse, CGU versionnées, add-ons et coupons d'abonnement.
- Feuille de route prévue dès la conception : revenue management, agences et allotements, MICE, bons cadeaux, day pass, pré-check-in en ligne, conciergerie, transferts, blanchisserie, enquêtes de satisfaction, marketing, channel manager, serrures électroniques, intégrateur de paiement, applications mobiles, IA.

## 6. Exigences non fonctionnelles
Montants en entiers (XOF), documents financiers immuables, p95 API < 300 ms, responsive tablette et mobile, PWA, WCAG 2.1 AA sur le portail, OWASP ASVS niveau 2, sauvegardes quotidiennes chiffrées, Sentry, logs JSON sans données sensibles.

## 7. Livrables
Application complète (3 espaces), au moins 9 rôles système + rôles personnalisés, Swagger, Docker Compose, données de démonstration réalistes (2 tenants, 3 plans), README, guides utilisateur et administrateur, tests (unitaires, intégration, e2e, isolation inter-tenants) verts en CI.

## 8. Planning
12 semaines en 7 vagues parallélisées (doc 06 §4). Les éléments P2 sont planifiés après la semaine 12.
