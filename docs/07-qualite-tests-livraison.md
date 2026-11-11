# 07 — Qualité, tests, livraison et risques

## 1. Définition de terminé (globale)
- Lint, typecheck et tests verts en CI ; couverture ≥ 80 % sur les modules ★ (tenancy, iam, billing, reservations, folio, night-audit).
- Chaque route `/t/*` et chaque événement Socket.io : test cross-tenant + test de permission refusée + test du mode suspendu (écriture refusée).
- Migrations réversibles ou documentées ; aucune requête N+1 sur les listes (vérifiée par le log de requêtes en test).
- Écrans : états vides, de chargement et d'erreur ; FR/EN ; mobile ≥ 360 px.
- Actions sensibles auditées.

## 2. Stratégie de tests
| Niveau | Outil | Cible |
|---|---|---|
| Unitaires | Vitest | Calcul des tarifs, taxes, prorata, machine à états de l'abonnement, allocation des paiements, numérotation, gain et utilisation des points, suggestions de réapprovisionnement, génération de la maintenance préventive |
| Intégration | Vitest + Supertest + Testcontainers (PostgreSQL et Redis réels) | RLS, anti-surbooking (2 réservations simultanées sur la même unité), conflits de praticien et de cabine au spa, transactions de paiement, liste d'attente, rooms Socket.io |
| E2E | Playwright | Inscription → essai → paiement manuel → actif ; réservation sur le portail → validation → check-in → restaurant et spa imputés sur la chambre → encaissement Mixx → check-out → facture ; audit de nuit ; suspension → lecture seule ; parcours portail WCAG (axe-core) |
| Sécurité | Suite cross-tenant générée, OWASP ZAP (baseline) en CI | — |
| Charge | k6 | Calendrier de 150 unités × 31 jours, 50 utilisateurs simultanés par tenant |

## 3. Jalons de livraison (12 semaines)
| Jalon | Semaine | Contenu | Critère d'acceptation |
|---|---|---|---|
| J1 Socle | S2 | L0, L0b | 3 applications démarrent avec `docker compose up` ; RLS prouvée par un test ; CI verte ; Swagger accessible |
| J2 Sécurité + monétisation | S5 | L1, L2, L4 | Un tenant s'inscrit, est en essai et paie (saisie Super Admin, reçu PDF), puis passe actif ; la suspension automatique est testée ; la 2FA fonctionne |
| J3 Cœur hébergement | S7 | L5–L9, L3 | Cycle complet d'un séjour avec folio, encaissements multi-modes, caisse, facture brandée ; back-office Super Admin |
| J4 Services | S9 | L8b–L14 | Audit de nuit ; restaurant et spa imputés sur la chambre ; stocks décrémentés ; shifts et pointage ; maintenance préventive |
| J5 Portail + analytique | S11 | L15, L16, L18 | Réservation en ligne de bout en bout ; dashboards et exports ; suite cross-tenant à 100 % |
| J6 Mise en production | S12 | L19, L20 | Pentest sans faille critique ou haute ; restauration de sauvegarde testée ; documentation livrée |
| J7 P2 | S13+ | Channel manager, intégrateur de paiement, API et webhooks, SSO | — |

## 4. Risques principaux
| Risque | Impact | Mitigation |
|---|---|---|
| Fuite de données entre tenants | Critique | RLS + contexte + tests générés + revue Opus |
| Double réservation | Élevé | Contrainte unique en base + test de concurrence |
| Erreurs de facturation ou de caisse | Élevé | Montants entiers, immutabilité, contre-passation, numérotation transactionnelle |
| Paiements manuels erronés ou en double | Moyen | Unicité de la référence, pièce jointe, double validation, contre-passation |
| Connectivité faible | Moyen | PWA, payload léger, retry côté client |
| Dérive de périmètre (« tout l'opérationnel ») | Élevé | Priorités M/S/P2 du doc 01, jalons |
| Intégrateur de paiement à venir | Faible | Abstraction `PaymentProvider` dès la v1 |
| Planning de 12 semaines tendu (9 modules + SaaS + portail) | Élevé | Parallélisation par lots, contrats figés en S2, périmètre de repli (doc 06 §4) |
| Licence FullCalendar Premium (timeline des ressources) | Moyen | Achat de la licence, ou alternative MIT (`react-calendar-timeline`) décidée en S1 |
| Points de fidélité utilisés comme paiement (dette comptable) | Moyen | Registre immuable, valeur du point paramétrée, rapport des points en circulation |
| Conformité des données (pièces d'identité) | Moyen | Chiffrement, rétention, purge, journalisation |

## 5. Points à valider avec le client
1. Tarifs réels des plans et durées d'essai (le doc 02 contient des valeurs indicatives).
2. Hypothèses H1 à H6 du doc 00.
3. Pays cibles (TVA, taxe de séjour, mentions de facture : Togo uniquement, ou UEMOA ?).
4. Fournisseurs SMS et WhatsApp.
5. Durées de grâce, de suspension et de purge.
6. Besoin d'une facture normalisée ou certifiée (système de facturation électronique OTR, si applicable).
7. Règles de fidélité : points par XOF, valeur d'un point, paliers, expiration.
8. Licence FullCalendar Premium : acceptée ou non.
9. Réservation sur le portail : acompte obligatoire ou paiement à l'hôtel.
10. Pays ciblés pour la facture électronique (OTR Togo, e-MECeF Bénin, FNE Côte d'Ivoire) et ordre de priorité des connecteurs.
11. Logiciel comptable cible pour l'export SYSCOHADA (Sage, Odoo, autre).
12. Prix des add-ons et règles des coupons.
