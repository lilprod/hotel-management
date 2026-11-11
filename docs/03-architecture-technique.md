# 03 — Architecture technique

## 1. Stack (alignée sur le prompt, alternatives tranchées)
| Couche | Choix | Remarque |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | Types et schémas Zod partagés |
| Frontend | **React 18 + TypeScript + Vite** | 3 applications : `client` (staff), `portal` (clients), `admin` (Super Admin) |
| UI | **Ant Design 5** (tokens de thème par tenant, ConfigProvider, mode sombre via `theme.darkAlgorithm`) | Composants denses en données |
| État | **Zustand** (UI, session) + **TanStack Query** (données serveur) | Pas de Redux |
| Routage, formulaires | React Router v6, React Hook Form + Zod | Schémas partagés depuis `packages/shared` |
| Graphiques, calendrier | **Recharts**, **FullCalendar** (resource timeline, Premium Scheduler) | Vérifier la licence FullCalendar Premium pour la timeline des ressources, sinon utiliser `react-calendar-timeline` (MIT) |
| i18n | i18next (FR, EN) | Montants au format `Intl.NumberFormat` avec XOF |
| Backend | **Node.js 20 + Express 4 + TypeScript** | Architecture modulaire en couches (§3) |
| Validation et documentation | **Zod** + `@asteasolutions/zod-to-openapi` → **Swagger UI** (`/api/docs`) | Une seule source de vérité |
| ORM, base | **Prisma** + **PostgreSQL 16** | SQL brut dans les migrations pour la RLS et les contraintes |
| Jobs | **BullMQ** sur Redis 7 (jobs répétables) | **Remplace node-cron**, qui s'exécute en double sur plusieurs instances et ne relance pas les jobs en échec |
| Temps réel | **Socket.io** + `@socket.io/redis-adapter` | Rooms cloisonnées par tenant (§4) |
| Fichiers | Multer (`memoryStorage`, limites) → **S3/MinIO** ; ClamAV | URL signées de 5 min |
| E-mail | Nodemailer + gabarits **MJML/Handlebars** brandés ; SMS et WhatsApp via adapters | Envois via la file `notifications` |
| PDF | **Gotenberg** (HTML → PDF) | Factures, reçus, fiches de police |
| Logs, monitoring | **Winston** (JSON, masquage des données sensibles), Sentry, `/health` et `/ready` | Identifiant de requête propagé |
| Sécurité | Helmet, CORS par liste blanche, express-rate-limit (store Redis), cookies `httpOnly`, CSRF, argon2id | HTTPS forcé derrière Traefik |
| Infrastructure | Docker Compose (dev) ; production sur VPS ou Kubernetes avec Traefik (TLS Let's Encrypt, domaines personnalisés) | `.env.development`, `.env.staging`, `.env.production` |
| CI | GitHub Actions : lint, typecheck, test, build, `pnpm audit`, images Docker | — |

## 2. Structure du dépôt (extension de la structure du prompt)
```
/hotel-management
├── /client                  # React — back-office staff (tenant)
│   └── /src/{components,pages,features,hooks,services,utils,types,theme}
├── /portal                  # React — portail client public (brandé par tenant)
├── /admin                   # React — espace Super Admin
├── /server
│   └── /src
│       ├── /modules/<module>/{routes,controller,service,repository,schemas,events}.ts
│       ├── /middleware      # tenant, auth, rbac, entitlements, subscription, validate, error, audit
│       ├── /jobs            # processeurs BullMQ (billing, reminders, night-audit, preventive, reorder…)
│       ├── /realtime        # passerelle Socket.io
│       ├── /lib             # prisma, redis, s3, mailer, pdf, logger, sequences
│       └── /utils
├── /packages
│   ├── /shared              # schémas Zod, DTO, enums, permissions, codes des fonctionnalités
│   ├── /ui                  # composants Ant Design partagés, StatusTag, thème
│   └── /config              # eslint, tsconfig, prettier
├── /database
│   ├── /prisma/schema.prisma
│   ├── /migrations          # migrations Prisma + SQL (RLS, contraintes d'exclusion)
│   └── /seeds               # plans, rôles, permissions, 2 tenants de démonstration réalistes
├── docker-compose.yml
└── /docs
```
Le prompt prévoyait des couches techniques globales (`/controllers`, `/routes`, `/services`). Je les remplace par un **découpage par module** (`/modules/<module>`) : un sous-agent travaille ainsi sur un seul dossier, ce qui limite les conflits et le contexte à charger.

## 3. Couches backend
`route` (Express Router + `validate(zodSchema)` + `can('perm')` + `requireFeature('spa')`) → `controller` (HTTP uniquement) → `service` (règles métier, transactions) → `repository` (Prisma). Les événements de domaine passent par une **outbox**, relayée vers BullMQ et Socket.io.

Middlewares globaux, dans l'ordre : `requestId` → `helmet` → `cors` → `rateLimit` → `tenantResolver` → `auth` → `subscriptionGuard` (lecture seule si suspendu) → `audit`.

## 4. Multi-tenancy
- **Base et schéma partagés + `tenant_id` + RLS** :
  `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- `tenantResolver` : `Host` → `tenant_domains` (cache Redis de 5 min) → `req.tenant` + **AsyncLocalStorage**.
- Une extension Prisma (`$extends`) encapsule chaque requête dans une transaction qui exécute `SET LOCAL app.tenant_id`. Le rôle applicatif est `NOBYPASSRLS`.
- L'application `admin` utilise un rôle DB distinct (`BYPASSRLS`), des routes `/api/v1/admin/*` et une authentification séparée.
- Le JWT contient `tid`. On vérifie `tid === req.tenant.id`, sinon on renvoie une erreur 403.
- **Socket.io** : authentification JWT au handshake, puis jonction **côté serveur uniquement** aux rooms `t:{tid}`, `t:{tid}:p:{propertyId}`, `t:{tid}:u:{userId}` et `t:{tid}:dept:{dept}`. Le client ne choisit jamais sa room.
- Portail client : les comptes `guest_accounts` sont propres à chaque tenant (le même e-mail peut exister chez deux tenants).

## 5. Règles techniques clés
- **Montants** : `BigInt` ou `Int` en unité minimale + devise ; XOF sans décimale.
- **Nuits** : `DATE`, arrivée incluse, départ exclu ; `business_date` par établissement, avancée par l'audit de nuit.
- **Anti-surbooking** : table `unit_nights` avec `UNIQUE (unit_id, night)`, insérée dans la transaction de confirmation ou d'affectation. Pour le spa et les activités, une contrainte d'exclusion GiST `tstzrange` sur le praticien, la cabine et le créneau, plus un compteur de capacité verrouillé (`SELECT … FOR UPDATE`).
- **Liste d'attente** : à l'événement `inventory.released`, le job `waitlist-match` notifie les candidats dans l'ordre, avec une offre qui expire.
- **Numérotation sans trou** : table `sequences` verrouillée dans la transaction d'émission.
- **Immutabilité** : factures, paiements, lignes de folio, mouvements de points et de stock ne sont jamais mis à jour ni supprimés ; on contre-passe. La suppression logique (`deleted_at`) est réservée aux référentiels.
- **Idempotence** : en-tête `Idempotency-Key` sur les créations de paiements, encaissements et réservations du portail.
- **API** : `/api/v1`, erreurs **RFC 7807**, pagination par curseur, filtres normalisés, `ETag` sur les référentiels.
- **Jobs BullMQ** : `subscription-lifecycle` (quotidien), `billing-reminders`, `booking-reminders`, `pending-expiry`, `waitlist-match`, `night-audit-check`, `preventive-maintenance`, `reorder-suggestions`, `loyalty-expiry`, `scheduled-reports`, `notifications`, `pdf-render`, `purge`. Chaque job reçoit un `tenantId` et réutilise le contexte RLS.

## 5 bis. Extensibilité (doc 08 §1, à livrer dans le lot L0)
- **Registre de modules** (X1) : `defineModule({ key, routes, permissions, features, jobs, events, settings, menu })`. Le noyau charge les modules déclarés, et le front construit la sidebar à partir des métadonnées de modules et des droits effectifs.
- **Droits effectifs** (X2, X3) : `entitlements.resolve(tenantId)` fait l'union du plan, des add-ons, des surcharges et des déploiements progressifs. Le résultat est mis en cache dans Redis et invalidé par l'événement `entitlements.changed`.
- **Paramètres** (X4) : `settings.get(key, { tenantId, propertyId, userId })` résout la hiérarchie, avec un schéma Zod et une valeur par défaut déclarés par le module.
- **Champs personnalisés** (X5) : définitions par entité, validation dynamique Zod, rendu automatique dans les formulaires Ant Design, filtrables (index GIN).
- **Adapters** (X8) : interfaces dans `server/src/lib/providers/*`, sélection par paramètre tenant ; implémentations v1 `manual` (paiement), `smtp`, `sms-local`, `s3`, `gotenberg`, `fiscal-none`.
- **Webhooks** (X9) : l'outbox est diffusée vers les abonnements webhook (URL, événements, secret HMAC), avec retries exponentiels et journal de livraison.
- **Agrégats analytiques** (X13) : tables `daily_stats_*` alimentées par l'audit de nuit et par un job horaire. Les dashboards lisent ces tables et non les tables transactionnelles.

## 6. Environnements
`local` (compose : postgres, redis, minio, mailpit, gotenberg, clamav) → `staging` (données de démonstration) → `production`. Migrations appliquées par la CI ; seed des plans par défaut et du compte Super Admin à partir de variables d'environnement.
