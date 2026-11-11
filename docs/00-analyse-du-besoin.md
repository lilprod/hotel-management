# 00 — Analyse critique du prompt « Gestion d'un complexe hôtelier »

Point de vue : chef de projet et développeur senior, spécialisé en SaaS et en PMS hôtelier.
Prompt analysé : application React / Node.js-Express / PostgreSQL, 9 modules, portail client, 12 semaines.
Objectif : en faire un **SaaS multi-tenant** avec un espace **Super Admin**, des **tenants** autonomes (sécurité, branding, opérationnel), **3 plans** (Standard, Medium, Premium) à tarifs et essais paramétrables, et des **paiements d'abonnement enregistrés manuellement** (Mixx, Moov Money, Espèces, Carte bancaire + référence facultative).

## 1. Points forts du prompt
- Périmètre fonctionnel riche et bien structuré (9 modules, cycle de vie de la réservation, folio unifié).
- Stack moderne et cohérente (TypeScript de bout en bout, React Query, Zod, Prisma, Socket.io).
- Préoccupations de production présentes : Docker, Swagger, logs, Helmet, rate limiting, RGPD, WCAG.
- Phasage en 5 phases et livrables explicites.

## 2. Ce qui manque ou pose problème

### 2.1 Bloquant : le prompt décrit une application mono-hôtel, pas un SaaS
| Manque | Conséquence | Correction (doc) |
|---|---|---|
| Aucune notion de **tenant** (pas de `tenant_id`, pas d'isolation) | Impossible de vendre à plusieurs hôtels ; risque de fuite de données | Base partagée + `tenant_id` + **RLS PostgreSQL** (03) |
| Aucun **espace Super Admin** | Pas de gestion des clients, des plans ni de la facturation | Application `admin` dédiée (01 §2) |
| Aucun **plan d'abonnement**, essai, quota ni limite de fonctionnalités | Pas de modèle économique | Plans, quotas, fonctionnalités, machine à états (02) |
| Aucun **paiement d'abonnement** | — | Enregistrement manuel Mixx, Moov Money, Espèces, Carte + référence, reçus, relances, suspension (02) |
| Pas de **branding par tenant** | Le portail client « luxe » ne peut porter qu'une seule marque | Thème, logos, documents, domaine personnalisé (01 TN-20) |
| **Sécurité** définie globalement, pas par tenant | Les hôtels ne peuvent pas définir leurs propres règles | Politiques de mot de passe, 2FA, sessions, IP, rôles personnalisés **par tenant** (05) |
| RBAC figé sur 7 rôles | Chaque hôtel a une organisation différente | Rôles système + rôles personnalisés à permissions fines (05) |
| Portail client unique | Les clients d'un hôtel A ne doivent jamais voir l'hôtel B | Portail par tenant (`{slug}.domaine` ou domaine propre), comptes clients cloisonnés |

### 2.2 Métier hôtelier : lacunes importantes
| Manque | Pourquoi c'est indispensable |
|---|---|
| **Tarification** : plans tarifaires, saisons, tarifs par jour de la semaine, enfant, lit supplémentaire, séjour minimum | « Pricing » est cité sans modèle tarifaire ; sans lui, le calcul du prix d'un séjour est impossible |
| **Taxes locales** : TVA 18 %, **taxe de séjour** | « Tax compliance » non défini pour le Togo (pays cible v1, voir doc 09) |
| **Moyens de paiement locaux** : Mixx, Moov Money | Le prompt ne cite que cash, card, transfer et loyalty ; le Mobile Money est majoritaire localement |
| **Fiche de police** au check-in | Obligation légale en Afrique de l'Ouest |
| **Audit de nuit** (clôture journalière, date d'exploitation) | Il fige le chiffre d'affaires du jour et poste les nuitées ; standard de tout PMS |
| **Sessions de caisse** (ouverture, clôture, écarts) | Contrôle anti-fraude des encaissements en espèces |
| **Housekeeping** comme module à part entière | Le prompt ne le traite que via le statut des chambres et les tâches, alors qu'il faut statuts propre/sale/inspecté, affectation et vue mobile |
| **Immutabilité financière** : factures numérotées sans trou, avoirs, contre-passations | La « suppression logique » ne suffit pas : on ne supprime ni ne modifie une facture émise |
| **Points de fidélité comme moyen de paiement** | Il faut un registre de points (gain, utilisation, expiration, valeur) ; c'est une dette comptable |
| **Paiement en ligne sur le portail** | Aucun intégrateur n'est disponible : il faut un mode « payer à l'hôtel » ou un **acompte déclaré** (Mobile Money + référence) validé par la réception |
| **Groupes et séminaires**, comptes débiteurs entreprises | Fréquent dans les complexes touristiques |
| **Module Activités** | Cité (« activities ») mais jamais spécifié : créneaux, capacité, guide |
| **Multi-établissements** | Un groupe peut posséder plusieurs complexes |
| **Notifications SMS / WhatsApp** | L'e-mail seul est insuffisant localement |
| Channel manager / OTA (Booking, Expedia) | Non cité ; à prévoir en phase 2 |

### 2.3 Choix techniques à trancher ou corriger
| Point du prompt | Problème | Décision |
|---|---|---|
| « Redux Toolkit **ou** Zustand », « Ant Design **ou** MUI », « Knex **ou** Prisma », « Joi **ou** Zod », « Recharts **ou** Chart.js » | Laisser le choix à chaque agent fragmente le code | **Zustand**, **Ant Design 5**, **Prisma**, **Zod**, **Recharts** (03) |
| `node-cron` | S'exécute en double sur plusieurs instances ; aucune reprise après erreur | **BullMQ** (jobs répétables + retry) sur Redis ; node-cron exclu |
| Socket.io | Aucun cloisonnement multi-tenant ; ne passe pas à l'échelle sans adapter | Rooms `tenant:{id}`, `property:{id}`, `user:{id}` + **adapter Redis** ; auth JWT au handshake |
| Multer (stockage local) | Incompatible avec plusieurs conteneurs | Multer en mémoire, puis stockage **S3/MinIO**, accès par URL signée |
| Suppression logique « pour l'audit » | Ce n'est pas un journal d'audit | Table `audit_logs` immuable + suppression logique pour les référentiels uniquement |
| Montants | Non spécifiés | Entiers en unité minimale (XOF = 0 décimale), jamais de float |
| Tests | **Absents du prompt** | Vitest, Supertest, Playwright, suite de tests d'isolation inter-tenants (07) |
| CI/CD, sauvegardes, monitoring | Absents | GitHub Actions, sauvegardes chiffrées quotidiennes, Sentry, uptime (03, 07) |
| Cibles de performance | Absentes | p95 API < 300 ms ; calendrier de 150 unités sur 31 jours < 1 s (01 TR) |
| Concurrence des réservations | « Overbooking prevention » sans mécanisme | Contrainte d'unicité `(room_id, night)` en base + transaction (03) |
| « Forecasting » | Ambigu | Prévisions sur les réservations déjà enregistrées (OTB) + moyenne N-1 ; pas de ML en v1 |

### 2.4 Planning : 12 semaines est ambitieux
9 modules, un portail client, une couche SaaS, l'enregistrement des paiements et la conformité tiennent en 12 semaines **seulement si** :
1. les fondations (schéma, isolation, contrats d'API) sont figées en semaines 1-2 ;
2. les modules sont développés **en parallèle** par des sous-agents bornés (06) ;
3. le périmètre est priorisé M / S / P2 (01).

Les éléments **P2** (après la semaine 12) sont le channel manager, le paiement en ligne via un intégrateur, le SSO, l'API publique et les webhooks, ainsi que les prévisions avancées.

## 3. Hypothèses retenues (à valider)
- **H1** : un tenant correspond à une organisation (hôtel ou complexe) et peut avoir plusieurs établissements selon son plan.
- **H2** : les clients de l'hôtel paient en Espèces, Carte (TPE), Virement, Mixx, Moov Money, points de fidélité ou compte débiteur. Tout paiement est **enregistré manuellement**, avec une référence facultative.
- **H3** : sur le portail client, une réservation en ligne est créée au statut `PENDING`. Elle devient `CONFIRMED` après validation par l'hôtel ou après validation d'un acompte déclaré.
- **H4** : l'accès se fait par `{slug}.app.domaine.com` (staff), `{slug}.domaine.com` (portail) et `admin.domaine.com`. Le domaine personnalisé est réservé au plan Premium.
- **H5** : en fin d'essai sans paiement, le compte passe en lecture seule. Les données sont conservées 90 jours (valeur paramétrable).
- **H6** : la devise par défaut est XOF, le fuseau Africa/Lome, les langues FR (par défaut) et EN.
- **H7 (validée)** : la v1 cible **uniquement le Togo** (fiscalité, mentions légales, fiche de police, IPDCP, Mixx et Moov). Les autres pays passent en P2 via le moteur de taxes et les adapters (doc 09).

## 4. Verdict
La couche « hôtel » du prompt est **solide à environ 70 %**. La couche **SaaS est absente à 100 %** : multi-tenant, Super Admin, plans, facturation, branding, sécurité par tenant. Plusieurs choix techniques (node-cron, Multer local, Socket.io non cloisonné, alternatives non tranchées) doivent être corrigés pour la production. Le prompt reformulé (`docs/PROMPT-FORMALISE.md`) et les documents 01 à 07 corrigent ces points.
