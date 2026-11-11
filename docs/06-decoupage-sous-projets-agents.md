# 06 — Découpage en sous-projets, délégation aux sous-agents et choix des modèles

## 1. Principes d'efficacité et d'économie de tokens
1. **Un agent = un module** (`server/src/modules/<m>` + `client/src/pages/<m>`). Il ne lit que les fichiers et sections de documents listés dans sa fiche.
2. **Contrats d'abord** : le lot L0 fige `schema.prisma`, `packages/shared` (Zod, enums, permissions, codes de fonctionnalités) et le squelette des middlewares. Ensuite, les modules avancent en parallèle sans se lire mutuellement.
3. **Fiches courtes** (≤ 40 lignes, gabarit §6) : identifiants d'exigences + références `docs/0X §Y`. Rien n'est recopié.
4. **Le modèle suit le risque** (§3). Opus n'est utilisé que là où une erreur coûte de l'argent, des données ou la sécurité.
5. **Découpe back et front** d'un même module : le backend (contrats API) passe d'abord, puis le frontend consomme l'OpenAPI généré.
6. **Isolation par worktree** pour les lots parallèles. L'orchestrateur fusionne après une CI verte.
7. **Revue Opus ciblée** sur les lots ★ uniquement. Les autres sont validés par la CI et les tests.
8. **Rendu ≤ 15 lignes** : fichiers, décisions, points ouverts, sans code.
9. **CLAUDE.md** contient les conventions, lues une seule fois.
10. Les tâches répétitives (CRUD de référentiels, traductions, seeds, gabarits) sont **regroupées** en une seule mission Haiku, pas dispersées.

## 2. Rôles d'agents
| Rôle | Modèle | Usage |
|---|---|---|
| Orchestrateur / chef de projet | **Opus 5.5** | Planifie, rédige les fiches, fusionne, arbitre. Ne code pas les modules |
| Architecte | **Opus 5.5** | L0, décisions transverses, revue des lots ★ |
| Dev backend | **Sonnet 5.5** (Opus pour le noyau ★) | Modules Express |
| Dev frontend | **Sonnet 5.5** | Pages React et Ant Design |
| Agent mécanique | **Haiku 5.5** | Seeds, i18n, gabarits e-mail et PDF, référentiels CRUD triviaux, documentation, lint |
| QA | **Sonnet 5.5** | Supertest, Playwright, suite cross-tenant |
| Revue sécurité | **Opus 5.5** | Avant la mise en production |

## 3. Grille de choix du modèle
| Critère | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| Ambiguïté | Nulle | Faible | Forte ou arbitrage |
| Impact d'une erreur | Cosmétique | Fonctionnel localisé | Argent, sécurité, isolation, intégrité |
| Nature | Gabarit, répétitif | CRUD, écrans, logique standard | Concurrence, machines à états, finance, architecture |
| Exemples | Traductions, seeds, modèles d'e-mails | Menu, plan de salle, shifts, rapports | RLS, anti-surbooking, folio, abonnements, audit de nuit, fidélité |

## 4. Lots, dépendances, modèles et planning sur 12 semaines
★ = lot à risque (conception et revue par Opus).

| Lot | Contenu | Exigences | Modèle | Dépend de | Semaines |
|---|---|---|---|---|---|
| **L0 Fondations** ★ | Monorepo, compose, CI, `schema.prisma` complet (doc 04), RLS, extension Prisma tenant, `packages/shared`, chaîne de middlewares, gestion d'erreurs RFC 7807, Winston, Swagger, Socket.io + rooms, BullMQ, S3, coquilles des 3 applications React (layout, thème Ant Design, mode sombre, i18n) | TR-*, doc 03 | **Opus** (schéma, RLS, middlewares) + Sonnet (coquilles UI, CI) | — | S1–S2 |
| L0b Seeds & i18n | Plans, rôles et permissions, 2 tenants de démonstration réalistes, traductions de base | SA-10, TN-03 | Haiku | L0 | S2 |
| **L1 Auth & IAM** ★ | Auth plateforme, tenant et portail (JWT et refresh), 2FA, sessions, politiques, RBAC, rôles personnalisés, audit, accès « en tant que » | TN-10…18, SA-25, SA-40/41 | **Opus** (back) / Sonnet (écrans) | L0 | S2–S3 |
| **L2 SaaS Billing & entitlements** ★ | Plans, tarifs, quotas, fonctionnalités, machine à états de l'abonnement, factures, **paiements manuels**, imputations, reçus, déclarations, relances, mode lecture seule | SA-10…39, TN-30…34, doc 02 | **Opus** (domaine, jobs) / Sonnet (écrans) | L1 | S3–S5 |
| L3 Back-office Super Admin | Tableau de bord, tenants, plans, paiements, rapports, annonces, support | SA-* | Sonnet | L2 (API) | S5–S6 |
| L4 Branding & onboarding | Thème par tenant, documents, modèles, domaine personnalisé, assistant de démarrage, inscription | TN-01/02, TN-20…25 | Sonnet | L1 | S3–S4 |
| L5 Paramétrage hébergement | Établissements, types, unités, plans tarifaires, saisons, taxes, politiques, produits, séquences | OP-01…08 | Sonnet (+ Haiku pour les CRUD simples) | L1 | S3–S4 |
| **L6 Moteur de réservation** ★ | Disponibilités, calcul du prix, `unit_nights`, cycle de vie, politiques, **liste d'attente**, dossier multi-services, `pending-expiry`, rappels | OP-10…18 | **Opus** (back) | L5 | S4–S6 |
| L6b Calendrier & UI réservations | Timeline FullCalendar, glisser-déposer, temps réel, formulaires | OP-10, OP-12 | Sonnet | L6 (API) | S5–S6 |
| L7 Réception | Arrivées et départs, check-in avec fiche de police, walk-in, changements, check-out | OP-20…23 | Sonnet | L6 | S6–S7 |
| **L8 Folio, encaissements, caisse, factures** ★ | Folio unifié, postes, taxes, encaissements (7 modes + référence), caisse, factures et avoirs PDF, comptes débiteurs | OP-90…96 | **Opus** (règles) / Sonnet (UI) | L6 | S6–S7 |
| **L8b Audit de nuit** ★ | Clôture, nuitées, date d'exploitation | OP-24 | **Opus** | L7, L8 | S8 |
| L9 CRM | Profils, préférences, communications, consentements, fusion, liste noire, sociétés | OP-30, 32…34 | Sonnet | L5 | S5–S6 |
| **L9b Fidélité** ★ | Registre de points (immuable), paliers, gain par département, utilisation comme moyen de paiement, expiration | OP-31 | **Opus** (registre) / Sonnet (UI) | L8, L9 | S8 |
| L10 Staff & RH | Employés, départements, shifts, pointage, tâches | OP-40…43, 45 | Sonnet | L1 | S7–S8 |
| L10b Messagerie & notifications | Conversations temps réel, centre de notifications, préférences | OP-44 | Sonnet | L0 (Socket.io) | S7 |
| L11 Restaurant | Plan de salle (éditeur), menu, régimes et allergènes, plats du jour, commandes et cuisine, imputation sur la chambre, réservations de table avec priorité aux résidents | OP-50…54 | Sonnet | L8, L12 (recettes) | S7–S9 |
| L12 Stocks | Articles, magasins, mouvements, recettes, alertes, fournisseurs, bons de commande, suggestions de réapprovisionnement | OP-70…76 | Sonnet (suggestions : Sonnet + revue) | L5 | S7–S8 |
| **L13 Spa & activités** ★ (planification) | Catalogue, praticiens, cabines, rendez-vous (contraintes d'exclusion), forfaits, historique, activités et créneaux | OP-60…65 | **Opus** (moteur de créneaux) / Sonnet (UI) | L8, L10 | S8–S9 |
| L14 Maintenance & housekeeping | Demandes, bons de travail, historique, préventif (job), housekeeping mobile | OP-80…84 | Sonnet | L5, L12 | S8–S9 |
| L15 Portail client | Vitrine brandée, parcours de réservation, compte, séjours, demandes, factures, points, déclaration d'acompte, WCAG | PC-01…07 | Sonnet | L6, L8, L9b, L13 | S9–S11 |
| L16 Dashboards & rapports | TO, ADR, RevPAR, KPI par département, prévisions, performance du staff, exports PDF, Excel et CSV | OP-100…104 | Sonnet | L8b, L11, L13 | S10–S11 |
| L17 Notifications & PDF | Adapters e-mail, SMS et WhatsApp, Gotenberg | TR-09/10 | Sonnet (adapters) / **Haiku** (gabarits MJML et PDF) | L0 | S3, puis au fil de l'eau |
| L18 QA transverse | Suite cross-tenant générée (HTTP + sockets), e2e des parcours, k6 | TR-01, TR-04 | Sonnet | chaque lot | continu, intensif S11 |
| **L19 Revue sécurité & mise en production** ★ | ASVS, durcissement, sauvegardes et restauration, runbooks, déploiement | TR-05/06 | **Opus** | tous | S12 |
| L20 Documentation | README, Swagger, guides utilisateur et administrateur FR | — | Haiku | fin de chaque lot | S12 |

### Vagues (agents en parallèle)
| Semaines | Vague | Lots |
|---|---|---|
| S1–S2 | V1 | L0 → L0b |
| S2–S4 | V2 | L1, L4, L5, L17 |
| S3–S6 | V3 | L2, L6, L9 |
| S5–S7 | V4 | L3, L6b, L7, L8, L10b |
| S7–S9 | V5 | L8b, L9b, L10, L11, L12, L13, L14 |
| S9–S11 | V6 | L15, L16, L18 |
| S12 | V7 | L19, L20 |

Chemins critiques : `L0 → L1 → L2` (monétisation) et `L0 → L5 → L6 → L8 → L8b → L16`.

### Marge et périmètre de repli
Si le planning glisse, on livre en S12 les plans **Standard** (L0–L9, L14, L15 partiel, L16 de base) et **Medium**, en reportant à S13–S14 : maintenance préventive, suggestions de réapprovisionnement, prévisions, exports programmés.

## 5. Répartition attendue
| Modèle | Part des missions | Part du risque couvert |
|---|---|---|
| Opus 5.5 | ~20 % | ~60 % (isolation, argent, concurrence) |
| Sonnet 5.5 | ~60 % | ~35 % |
| Haiku 5.5 | ~20 % | ~5 % |

## 6. Gabarit de fiche de mission
```markdown
# Mission <Lot>-<n> — <titre>
Modèle : <haiku|sonnet|opus> · Isolation : worktree · Branche : feat/<lot>-<n>
## Objectif
<1–3 phrases>
## Exigences
<IDs du doc 01> — lire uniquement : docs/0X §Y, CLAUDE.md
## Périmètre autorisé
server/src/modules/<m>/**, client/src/pages/<m>/**, tests associés
Interdit : database/prisma/schema.prisma, packages/shared/** (demander à l'orchestrateur)
## Contrats
Schémas : packages/shared/src/<m>.ts · Routes : /api/v1/t/<m>/* · Événements : <m>.<event>
## Définition de terminé
- [ ] pnpm lint && pnpm typecheck && pnpm test --filter <m> verts
- [ ] Règles métier testées + 1 test cross-tenant et 1 test de permission refusée par route
- [ ] can() et requireFeature() posés ; écritures sensibles auditées
- [ ] Swagger à jour (généré)
## Rendu
≤ 15 lignes : fichiers, décisions, points ouverts. Pas de code.
```

## 7. Missions prêtes à lancer (V1–V2)
| Mission | Modèle | Résumé |
|---|---|---|
| L0-1 Monorepo, compose, CI | Sonnet | pnpm, Turborepo, docker-compose (pg, redis, minio, mailpit, gotenberg, clamav), GitHub Actions |
| L0-2 Schéma Prisma + RLS ★ | Opus | Doc 04 complet, migrations SQL RLS et contraintes, extension Prisma tenant, test d'isolation de base |
| L0-3 Noyau Express ★ | Opus | Chaîne de middlewares (doc 03 §3), erreurs, Winston, Zod → OpenAPI, Socket.io + rooms, BullMQ, S3 |
| L0-4 `packages/shared` | Sonnet | Enums, permissions, codes de fonctionnalités, DTO Zod par module |
| L0-5 Coquilles React ×3 | Sonnet | Vite, Ant Design, thème dynamique, clair et sombre, sidebar, cloche, routage, i18n |
| L0b-1 Seeds & i18n | Haiku | Plans (doc 02 §1), rôles (doc 05 §2), paramètres Togo et 2 tenants de démonstration togolais fictifs (doc 09 §1, §9), jours fériés, plan SYSCOHADA |
| L1-1 Auth & sessions ★ | Opus | Doc 05 §1 (staff, portail, plateforme) |
| L1-2 RBAC, audit, accès « en tant que » ★ | Opus | Doc 05 §2, §4, §7 |
| L1-3 Écrans sécurité | Sonnet | Utilisateurs, rôles, politiques, sessions, journal |
| L4-1 Branding & onboarding | Sonnet | TN-01/02, TN-20…25 |
| L5-1 Référentiels hébergement | Sonnet + Haiku | OP-01…08 |
| L17-1 Notifications & PDF | Sonnet + Haiku | Adapters + gabarits |

## 8. Lots complémentaires (doc 08) et intégration au planning
| Lot | Contenu | Exigences | Modèle | Dépend de | Semaines |
|---|---|---|---|---|---|
| L0 (extension) ★ | Registre de modules, droits effectifs, paramètres hiérarchiques, champs personnalisés, listes, moteur de taxes, interfaces des adapters, multi-devise, agrégats analytiques | X1–X13 | **Opus** | — | S1–S2 (+2 j) |
| L2 (extension) ★ | Add-ons, coupons, CGU versionnées, TVA plateforme, export avant purge | EX-01, 03, 04, 11 | **Opus** (calculs) / Sonnet | L1 | S4–S5 |
| **L21 Import de données** | Assistant d'import CSV et Excel (correspondance des colonnes, aperçu, validation, rapport) pour clients, unités, tarifs, réservations futures, articles | EX-20 | Sonnet | L5, L9 | S6–S7 |
| **L22 Comptabilité & clôtures** ★ | Plan de comptes SYSCOHADA, correspondance des comptes, exports de journaux, clôture mensuelle | EX-50, 55 | **Opus** (règles d'écriture) / Haiku (plan de comptes seed) | L8b | S9–S10 |
| L23 Matériel | Agent d'impression local (ESC/POS), tiroir-caisse, lecteur de codes-barres | EX-70 | Sonnet | L11 | S9 |
| L8 (extension) ★ | Multi-devise à l'encaissement, `FiscalInvoiceProvider` (implémentation `none`) | EX-21, 51 | **Opus** | L6 | S6–S7 |
| L14 (extension) | Minibar, objets trouvés | EX-32, 33 | Sonnet | L12 | S8–S9 |
| L16 (extension) | Consolidé multi-établissements, états de TVA et de taxe de séjour | EX-41, 52 | Sonnet | L8b | S10–S11 |
| L17 (extension) | Parcours e-mail automatisés | EX-65 | Haiku (gabarits) / Sonnet (déclencheurs) | L6 | S6 |
| v1.1 (S13–S14) | Points **S** du doc 08 | EX-* S | Sonnet (Opus : EX-22 revenue, EX-23 agences, EX-54 rapprochement) | v1 | S13–S14 |
| Feuille de route | Points **P2** et **P3** du doc 08 | EX-* P2/P3 | selon la grille §3 | v1.1 | M4+ |

Après ces ajouts : 29 lots en v1 ; environ 22 % Opus, 58 % Sonnet, 20 % Haiku. La mise en production reste en S12.
