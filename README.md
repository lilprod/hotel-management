# Hotel Management SaaS

Plateforme SaaS multi-tenant de gestion hôtelière (PMS) : espace **Super Admin** + espaces **tenants** (hôtels), 3 plans (Standard / Medium / Premium) à tarifs et essais paramétrables, paiements d'abonnement enregistrés manuellement (Mixx, Moov Money, Espèces, Carte bancaire).

## Documentation du projet
| # | Document | Contenu |
|---|---|---|
| 00 | [Analyse du besoin](docs/00-analyse-du-besoin.md) | Couverture du besoin initial, manques, hypothèses |
| 01 | [Cahier des charges](docs/01-cahier-des-charges.md) | Exigences SA / TN / OP / TR priorisées |
| 02 | [Plans, abonnements et facturation](docs/02-plans-abonnements-facturation.md) | Matrice des plans, cycle de vie, paiements manuels, relances |
| 03 | [Architecture technique](docs/03-architecture-technique.md) | Stack, multi-tenancy (RLS), modules, règles techniques |
| 04 | [Modèle de données](docs/04-modele-de-donnees.md) | Tables plateforme et tenant, contraintes |
| 05 | [Sécurité et RBAC](docs/05-securite-rbac.md) | Authentification, permissions, isolation, impersonation, audit |
| 06 | [Découpage et sous-agents](docs/06-decoupage-sous-projets-agents.md) | Lots, dépendances, vagues, modèles assignés, gabarit de mission |
| 07 | [Qualité et livraison](docs/07-qualite-tests-livraison.md) | Définition de terminé, tests, jalons, risques |

Conventions pour les agents de développement : [CLAUDE.md](CLAUDE.md).
