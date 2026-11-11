# 03 — Architecture technique

## 1. Stack retenue (recommandation)
| Couche | Choix | Justification |
|---|---|---|
| Monorepo | **pnpm + Turborepo** | Types partagés front/back, builds incrémentaux |
| Backend | **NestJS 11 (TypeScript)**, architecture modulaire | Modules = bounded contexts ; guards et intercepteurs pour le tenant et les plans |
| ORM | **Prisma** + SQL brut pour les contraintes avancées | Productivité ; migrations versionnées |
| Base de données | **PostgreSQL 16** | RLS, contraintes d'exclusion (anti-double-booking), JSONB |
| Cache / files | **Redis 7 + BullMQ** | Jobs (relances, audit de nuit, PDF, e-mails/SMS) |
| Frontend | **Next.js 15 (App Router) + React + Tailwind + shadcn/ui** | Thème dynamique par tenant (variables CSS) ; PWA |
| État et données | TanStack Query, Zod (schémas partagés) | Validation unique front/back |
| Fichiers | Stockage compatible S3 (MinIO en dev) | Logos, pièces d'identité (chiffrées), PDF |
| PDF | Gotenberg (HTML → PDF) | Gabarits HTML brandés |
| E-mail / SMS | Adapters (SMTP/Brevo ; SMS : agrégateur local) | Interchangeables |
| Authentification | Sessions JWT courtes (15 min) + refresh token rotatif (cookie httpOnly) ; TOTP (otplib) ; argon2id | — |
| Observabilité | OpenTelemetry, Pino (logs JSON), Sentry | — |
| Déploiement | Docker, Docker Compose (dev), Kubernetes ou VPS + Traefik (prod) ; TLS automatique (Let's Encrypt) pour les domaines personnalisés | — |
| CI | GitHub Actions : lint, typecheck, tests, build, scan de dépendances | — |

## 2. Multi-tenancy
**Modèle : base partagée, schéma partagé, colonne `tenant_id` + Row-Level Security PostgreSQL** (défense en profondeur).

- Résolution du tenant : sous-domaine (`{slug}.app.domaine.com`) ou domaine personnalisé → table `tenant_domains` → `tenant_id` (mis en cache dans Redis).
- Un middleware Nest place le `tenant_id` dans `AsyncLocalStorage`. Une **extension Prisma** exécute `SET LOCAL app.tenant_id = '…'` dans chaque transaction et ajoute le filtre `tenant_id`.
- Politique RLS sur **toutes** les tables tenant :
  `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- L'espace Super Admin utilise un **rôle PostgreSQL distinct** (`BYPASSRLS`) et une application et un domaine séparés (`admin.`).
- Le JWT contient `tenant_id` ; une requête est rejetée si le `tenant_id` du jeton est différent du tenant résolu par l'hôte.
- **Test obligatoire** : une suite e2e « cross-tenant » tente de lire et d'écrire les ressources d'un tenant B avec un jeton du tenant A, pour chaque route (générée à partir de l'inventaire des routes).

## 3. Découpage des applications et des paquets
```
apps/
  api/            NestJS (routes /admin/* et /t/* séparées par module)
  web-tenant/     Next.js — espace hôtel
  web-admin/      Next.js — espace Super Admin
  worker/         BullMQ (jobs : facturation, relances, audit de nuit, PDF, notifications)
packages/
  db/             Schéma Prisma, migrations, SQL RLS, seeds
  contracts/      Schémas Zod + types DTO partagés
  ui/             Design system (shadcn), thème dynamique
  config/         eslint, tsconfig, tailwind preset
  pdf-templates/  Gabarits HTML des factures, reçus, fiches de police
```

## 4. Modules backend (bounded contexts)
| Module | Contexte | Dépend de |
|---|---|---|
| `platform-auth` | Authentification des utilisateurs plateforme | — |
| `tenancy` | Tenants, domaines, résolution | — |
| `billing` | Plans, tarifs, abonnements, factures, paiements, relances | tenancy |
| `entitlements` | Fonctionnalités et quotas (guard, décorateurs) | billing |
| `iam` | Utilisateurs tenant, rôles, permissions, politiques de sécurité, sessions, 2FA | tenancy, entitlements |
| `audit` | Journal immuable (plateforme + tenant) | — |
| `branding` | Thème, logos, documents, domaine personnalisé | tenancy |
| `property` | Établissements, types de chambres, chambres, équipements | entitlements |
| `rates` | Plans tarifaires, saisons, taxes, politiques | property |
| `reservations` | Disponibilités, réservations, groupes, planning | property, rates, crm |
| `front-desk` | Check-in/out, fiches de police, changements de chambre | reservations |
| `folio` | Folios, postes, factures, avoirs, encaissements, caisse, city ledger | front-desk |
| `night-audit` | Clôture journalière | folio, reservations |
| `housekeeping` | Statuts des chambres, tâches | property |
| `maintenance` | Tickets | property |
| `pos` | Points de vente, commandes, tickets | folio, inventory |
| `inventory` | Articles, magasins, mouvements, inventaires | — |
| `crm` | Clients, sociétés | — |
| `reporting` | KPI, rapports, exports | lecture multi-modules (vues SQL) |
| `notifications` | E-mail, SMS, WhatsApp, modèles | — |
| `files` | Upload, scan antivirus (ClamAV), URL signées | — |

Communication interne : appels de services pour le synchrone, **outbox + BullMQ** pour les événements (`reservation.confirmed`, `payment.confirmed`, `subscription.suspended`…).

## 5. Règles techniques clés
- **Montants** : entiers (`BIGINT`) en unité minimale, plus la devise. Jamais de `float`.
- **Dates hôtelières** : `DATE` pour les nuits (arrivée inclusive, départ exclusive) ; `TIMESTAMPTZ` pour les événements ; une « date d'exploitation » (`business_date`) par établissement, avancée par l'audit de nuit.
- **Anti-double-booking** : table `room_nights` (une ligne par chambre et par nuit assignée) avec `UNIQUE (tenant_id, room_id, night)`, ou une contrainte d'exclusion `EXCLUDE USING gist (room_id WITH =, daterange(arrival, departure) WITH &&)` sur les affectations actives.
- **Numérotation sans trou** : table `sequences` verrouillée (`SELECT … FOR UPDATE`) dans la transaction d'émission.
- **Immutabilité** : factures émises, paiements et audit ne sont jamais modifiés ; on corrige par contre-passation ou avoir.
- **Idempotence** : en-tête `Idempotency-Key` sur les POST de paiement et d'encaissement.
- **Mode lecture seule (abonnement suspendu)** : un guard global refuse les méthodes non-GET sur `/t/*` (sauf auth, export et déclaration de paiement), avec le code `SUBSCRIPTION_SUSPENDED`.
- **API** : REST JSON, préfixe `/api/v1`, OpenAPI généré, pagination par curseur, erreurs RFC 7807.

## 6. Environnements
`local` (docker compose : postgres, redis, minio, mailpit, gotenberg) → `staging` → `production`. Migrations appliquées par la CI, *seed* des plans par défaut.
