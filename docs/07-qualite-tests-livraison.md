# 07 — Qualité, tests, livraison et risques

## 1. Définition de terminé (globale)
- Lint, typecheck et tests verts en CI ; couverture ≥ 80 % sur les modules ★ (tenancy, iam, billing, reservations, folio, night-audit).
- Chaque route `/t/*` : test cross-tenant + test de permission refusée + test du mode suspendu (écriture refusée).
- Migrations réversibles ou documentées ; aucune requête N+1 sur les listes (vérifiée par le log de requêtes en test).
- Écrans : états vides, de chargement et d'erreur ; FR/EN ; mobile ≥ 360 px.
- Actions sensibles auditées.

## 2. Stratégie de tests
| Niveau | Outil | Cible |
|---|---|---|
| Unitaires | Vitest | Calcul des tarifs, taxes, prorata, machine à états de l'abonnement, allocation des paiements, numérotation |
| Intégration | Vitest + Testcontainers (PostgreSQL réel) | RLS, contraintes anti-double-booking, transactions de paiement, concurrence (2 réservations simultanées sur la même chambre) |
| E2E | Playwright | Parcours : inscription → essai → paiement manuel → actif ; réservation → check-in → folio → encaissement → check-out → facture ; audit de nuit ; suspension → lecture seule |
| Sécurité | Suite cross-tenant générée, OWASP ZAP (baseline) en CI | — |
| Charge | k6 | Planning de 100 chambres × 31 jours, 50 utilisateurs simultanés par tenant |

## 3. Jalons de livraison
| Jalon | Contenu | Critère d'acceptation |
|---|---|---|
| J1 Socle | V1–V2 | Connexion plateforme et tenant, RLS prouvée, CI verte |
| J2 Monétisation | V3 + L5 | Un tenant peut s'inscrire, être en essai, payer (saisie Super Admin) et passer actif ; suspension automatique testée |
| J3 PMS cœur (MVP Standard) | L6–L11 | Cycle complet d'un séjour, factures et reçus brandés, caisse |
| J4 Medium | L12, L13, L14 | POS imputé sur la chambre, stocks, KPI (TO, ADR, RevPAR) |
| J5 Mise en production | L16–L18 | Pentest sans faille critique ou haute, restauration de sauvegarde testée, documentation |
| J6 Premium (P2) | Moteur de réservation, API, SSO, domaine personnalisé, channel manager, agrégateur de paiement | — |

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
| Conformité des données (pièces d'identité) | Moyen | Chiffrement, rétention, purge, journalisation |

## 5. Points à valider avec le client
1. Tarifs réels des plans et durées d'essai (le doc 02 contient des valeurs indicatives).
2. Hypothèses H1 à H6 du doc 00.
3. Pays cibles (TVA, taxe de séjour, mentions de facture : Togo uniquement, ou UEMOA ?).
4. Fournisseurs SMS et WhatsApp.
5. Durées de grâce, de suspension et de purge.
6. Besoin d'une facture normalisée ou certifiée (système de facturation électronique OTR, si applicable).
