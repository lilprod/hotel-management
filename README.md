# Hotel & Resort Management SaaS

Plateforme SaaS multi-tenant de gestion de complexes hôteliers et touristiques (hébergement, restaurant, spa, activités). Elle comporte trois espaces : **Super Admin**, **back-office tenant** (staff) et **portail client**. Trois plans sont proposés (Standard, Medium, Premium), avec tarifs et essais paramétrables. Les paiements d'abonnement sont enregistrés manuellement (Mixx, Moov Money, Espèces, Carte bancaire + référence).

Stack : React 18 + TypeScript (Vite, Ant Design) · Node.js / Express + TypeScript · PostgreSQL 16 (Prisma, RLS) · Redis (BullMQ, Socket.io) · Docker.

## Documentation du projet
| # | Document | Contenu |
|---|---|---|
| — | [Prompt formalisé](docs/PROMPT-FORMALISE.md) | Brief maître consolidé (SaaS + complexe touristique) |
| 00 | [Analyse du besoin](docs/00-analyse-du-besoin.md) | Analyse critique du prompt : points forts, manques, corrections, hypothèses |
| 01 | [Cahier des charges](docs/01-cahier-des-charges.md) | Exigences SA / TN / OP / PC / TR priorisées |
| 02 | [Plans, abonnements et facturation](docs/02-plans-abonnements-facturation.md) | Matrice des plans, cycle de vie, paiements manuels, relances |
| 03 | [Architecture technique](docs/03-architecture-technique.md) | Stack, structure du dépôt, multi-tenancy, règles techniques, jobs |
| 04 | [Modèle de données](docs/04-modele-de-donnees.md) | Tables plateforme, tenant et modules du complexe |
| 05 | [Sécurité et RBAC](docs/05-securite-rbac.md) | Authentification, rôles, isolation, accès « en tant que », audit |
| 06 | [Découpage et sous-agents](docs/06-decoupage-sous-projets-agents.md) | 29 lots, vagues sur 12 semaines, modèle par lot, gabarit de mission |
| 07 | [Qualité et livraison](docs/07-qualite-tests-livraison.md) | Définition de terminé, tests, jalons, risques, points à valider |
| 08 | [Extensions et points non couverts](docs/08-extensions-points-non-couverts.md) | Principes d'extensibilité, ~70 points ajoutés au-delà du prompt, priorités et plans |

Conventions pour les agents de développement : [CLAUDE.md](CLAUDE.md).
