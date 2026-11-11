# 06 — Découpage en sous-projets, délégation aux sous-agents et choix des modèles

## 1. Principes d'efficacité et d'économie de tokens
1. **Un agent = un module borné** (bounded context) avec un contrat d'entrée et de sortie explicite. Il ne lit **que** les documents et dossiers listés dans sa fiche.
2. **Contrats d'abord** : le lot L0 fige les schémas (`packages/db`, `packages/contracts`). Ensuite, les agents travaillent en parallèle sans se lire mutuellement le code.
3. **Fiche de mission courte** (≤ 40 lignes) : objectif, exigences (IDs du doc 01), fichiers autorisés, définition de terminé, commandes de vérification. Pas de copie des documents : uniquement des références `docs/0X §Y`.
4. **Modèle adapté à la complexité** (§3) : Opus pour les décisions à fort risque, Sonnet pour l'implémentation standard, Haiku pour les tâches mécaniques.
5. **Isolation `worktree`** pour les lots parallèles, puis fusion par l'orchestrateur après revue.
6. **Revue ciblée** : la revue Opus ne porte que sur les modules à risque (tenancy, IAM, billing, réservations, folio). Les autres lots sont validés par la CI (lint, typecheck, tests).
7. **CLAUDE.md** à la racine : conventions communes, lues une fois par chaque agent au lieu d'être répétées dans chaque fiche.
8. **Sorties concises** : un agent rend un résumé (≤ 15 lignes) : fichiers modifiés, décisions, points ouverts. Il ne recopie pas le code.

## 2. Rôles d'agents
| Rôle | Modèle | Usage |
|---|---|---|
| **Orchestrateur / chef de projet** | Opus 5.5 | Planifie, rédige les fiches, fusionne, arbitre. Ne code pas les modules |
| **Architecte** | Opus 5.5 | Lot L0, décisions transverses, revue des modules à risque |
| **Dev backend** | Sonnet 5.5 (Opus si marqué ★) | Modules NestJS |
| **Dev frontend** | Sonnet 5.5 | Écrans Next.js |
| **Agent mécanique** | Haiku 5.5 | Seeds, traductions i18n, fixtures, gabarits d'e-mails, documentation d'API, corrections de lint |
| **QA** | Sonnet 5.5 | Tests e2e (Playwright), tests cross-tenant |
| **Revue sécurité** | Opus 5.5 | Revue des lots IAM, tenancy, billing, fichiers, avant la mise en production |

## 3. Grille de choix du modèle
| Critère | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| Ambiguïté | Aucune (spécification complète) | Faible | Forte, ou arbitrage nécessaire |
| Impact d'une erreur | Cosmétique | Fonctionnel, localisé | Sécurité, argent, intégrité des données, isolation |
| Nature | Répétitif, gabarit | CRUD, écrans, logique métier standard | Concurrence, machines à états, règles financières, architecture |
| Exemples | i18n, seeds, mocks, docs | CRUD des chambres, écrans du planning, rapports | RLS, anti-double-booking, numérotation, abonnements, audit de nuit |

## 4. Lots (sous-projets), dépendances et affectation

Légende : ★ = composant à risque (Opus pour la conception + revue).

| Lot | Contenu | Exigences | Modèle | Dépend de | Parallélisable |
|---|---|---|---|---|---|
| **L0 Fondations** ★ | Monorepo, docker compose, CI, `packages/db` (schéma complet du doc 04), RLS, extension Prisma tenant, `packages/contracts` (DTO Zod), `packages/ui` (thème dynamique), CLAUDE.md | TR-01, TR-08, doc 03 | **Opus** | — | Non (bloquant) |
| L0b Outillage | Seeds (plans, rôles système, permissions, données de démo), i18n FR/EN de base | SA-10, TN-03 | Haiku | L0 | Oui |
| **L1 Tenancy + Auth plateforme** ★ | Résolution du tenant, domaines, auth plateforme + 2FA, utilisateurs plateforme | SA-40, SA-41 | **Opus** | L0 | Oui (avec L2) |
| **L2 IAM tenant + sécurité** ★ | Auth tenant, sessions, 2FA, politiques, RBAC, audit, impersonation | TN-10…TN-18, SA-25 | **Opus** (conception + guards) / Sonnet (écrans) | L0 | Oui |
| **L3 Billing & entitlements** ★ | Plans, tarifs, quotas, fonctionnalités, abonnements (machine à états), factures, paiements manuels, allocations, reçus, déclarations, relances, mode lecture seule | SA-10…SA-39, TN-30…TN-34, doc 02 | **Opus** (domaine + jobs) / Sonnet (écrans) | L1 | Oui (avec L4) |
| L4 Branding | Thème, logos, documents, modèles de messages, domaine personnalisé | TN-20…TN-25 | Sonnet | L1 | Oui |
| L5 Back-office Super Admin (UI) | Tableau de bord, tenants, plans, paiements, rapports, annonces, support | SA-01…SA-46 | Sonnet | L1, L3 (API) | Oui |
| L6 Paramétrage hôtel | Établissements, types, chambres, tarifs, saisons, taxes, politiques, produits, séquences, onboarding | OP-01…OP-09, TN-01, TN-02 | Sonnet | L2 | Oui |
| **L7 Réservations & planning** ★ | Moteur de disponibilité et de tarif, réservations, groupes, `room_nights`, planning (UI) | OP-10…OP-18 | **Opus** (moteur + contraintes) / Sonnet (UI planning) | L6 | Non (après L6) |
| L8 Réception | Check-in/out, fiche de police, walk-in, changements | OP-20…OP-25 | Sonnet | L7 | Oui (avec L10, L11) |
| **L9 Folio, facturation, caisse** ★ | Folios, postes, taxes, factures et avoirs, encaissements, sessions de caisse, city ledger | OP-30…OP-34 | **Opus** (règles) / Sonnet (UI) | L7 | Oui (avec L8) |
| **L9b Audit de nuit** ★ | Clôture journalière | OP-35 | **Opus** | L8, L9 | Non |
| L10 Housekeeping & maintenance | Statuts, tâches, vue mobile, tickets | OP-40…OP-43 | Sonnet | L6 | Oui |
| L11 CRM | Clients, sociétés, VIP, liste noire, fusion | OP-70…OP-72 | Sonnet | L6 | Oui |
| L12 POS | Points de vente, commandes, imputation sur la chambre | OP-50…OP-53 | Sonnet | L9 | Oui (avec L13) |
| L13 Stocks | Articles, mouvements, inventaire, CMP | OP-60…OP-63 | Sonnet | L6 | Oui |
| L14 Rapports & KPI | Vues SQL, tableaux de bord, exports | OP-80…OP-83 | Sonnet | L9b | Oui |
| L15 Notifications & PDF | Adapters e-mail/SMS/WhatsApp, Gotenberg, gabarits | — | Sonnet (adapters) / Haiku (gabarits) | L0 | Oui |
| L16 QA transverse | Suite cross-tenant générée, e2e des parcours critiques, tests de charge du planning | TR-01, TR-04 | Sonnet | Chaque lot | Continu |
| **L17 Revue sécurité & mise en production** ★ | Revue ASVS, durcissement, sauvegardes et restauration, runbooks | TR-05, TR-06, TR-07 | **Opus** | Tous | Non |
| L18 Documentation | OpenAPI, guide utilisateur FR, guide admin | — | Haiku | Fin de chaque lot | Oui |

### Chemin critique
`L0 → L1 → L3` (monétisation) et `L0 → L2 → L6 → L7 → L9 → L9b → L14`.

### Vagues d'exécution
| Vague | Lots en parallèle | Objectif |
|---|---|---|
| V1 | L0 | Socle |
| V2 | L0b, L1, L2, L15 | Socle sécurité + outillage |
| V3 | L3, L4, L6 | Monétisation + paramétrage |
| V4 | L5, L7, L10, L11, L13 | Back-office + cœur réservation |
| V5 | L8, L9, L12 | Réception, caisse, POS |
| V6 | L9b, L14, L16 | Clôture, rapports, QA |
| V7 | L17, L18 | Mise en production |

**MVP commercialisable** = V1 à V5 sans L12/L13 (modules Medium) ⇒ plan Standard vendable ; V5 complet ⇒ Medium ; L19 (P2 : moteur de réservation, API, SSO, channel manager) ⇒ Premium complet.

## 5. Estimation de l'effort (indicative)
| Taille | Lots | Fiches par lot |
|---|---|---|
| S | L0b, L4, L11, L15, L18 | 1–2 |
| M | L1, L5, L6, L8, L10, L12, L13, L14, L16 | 2–4 |
| L | L0, L2, L3, L7, L9, L9b, L17 | 4–6 (découpées backend / frontend / tests) |

Répartition visée : ~20 % des tâches en Opus (≈ 50 % de la valeur à risque), ~60 % en Sonnet, ~20 % en Haiku.

## 6. Gabarit de fiche de mission (à copier)
```markdown
# Mission <Lot>-<n> — <titre>
Modèle : <haiku|sonnet|opus> · Isolation : worktree · Branche : feat/<lot>-<n>
## Objectif
<1–3 phrases>
## Exigences
<IDs du doc 01, ex. OP-30, OP-31> — référence : docs/0X §Y (ne pas lire les autres docs)
## Périmètre autorisé
apps/api/src/modules/<module>/**, apps/web-tenant/app/(app)/<module>/**, tests associés
Ne pas modifier : packages/db/** (demander à l'orchestrateur), autres modules
## Contrats
Entrées : DTO de packages/contracts/<module>.ts · Sorties : routes /api/v1/t/<module>/*
## Définition de terminé
- [ ] pnpm lint && pnpm typecheck && pnpm test --filter <module> passent
- [ ] Tests : règles métier + 1 test cross-tenant par route
- [ ] Permissions @Can et @RequiresFeature posées
- [ ] Audit des écritures sensibles
## Rendu attendu
Résumé ≤ 15 lignes : fichiers, décisions, points ouverts. Pas de code dans le résumé.
```

## 7. Fiches prêtes à lancer (vague V1–V2)
| Mission | Modèle | Résumé |
|---|---|---|
| L0-1 Monorepo & CI | Sonnet | Turborepo, configs, docker compose (pg, redis, minio, mailpit, gotenberg), GitHub Actions |
| L0-2 Schéma DB + RLS ★ | Opus | Prisma + SQL RLS du doc 04, extension Prisma tenant, test d'isolation de base |
| L0-3 Contrats Zod | Sonnet | DTO par module (dérivés du doc 04), erreurs RFC 7807 |
| L0-4 UI kit + thème | Sonnet | shadcn, layout admin/tenant, thème par variables CSS |
| L0b-1 Seeds & i18n | Haiku | Plans par défaut (doc 02 §1), rôles système (doc 05 §2), libellés FR/EN |
| L1-1 Résolution tenant ★ | Opus | Middleware hôte → tenant, cache, garde JWT/hôte |
| L2-1 Auth tenant + sessions + 2FA ★ | Opus | Doc 05 §1 |
| L2-2 RBAC + audit ★ | Opus | Doc 05 §2 et §7 |
| L2-3 Écrans sécurité | Sonnet | Utilisateurs, rôles, politiques, sessions, journal |
| L15-1 Notifications & PDF | Sonnet | Adapters + file BullMQ |
