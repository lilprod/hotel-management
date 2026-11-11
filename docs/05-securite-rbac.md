# 05 — Sécurité et RBAC

## 1. Authentification
- Mots de passe hachés en **argon2id** ; politique définie par le tenant (doc 01, TN-12) ; vérification contre une liste de mots de passe compromis (top 100k).
- Access token JWT de 15 min (claims : `sub`, `tid`, `sid`, `perm_ver`) + refresh token rotatif (cookie `httpOnly`, `Secure`, `SameSite=Lax`) ; détection de réutilisation → révocation de toute la famille de jetons.
- 2FA **TOTP** (+ 10 codes de secours) ; OTP par SMS ou e-mail en secours ; obligatoire pour la plateforme.
- Verrouillage progressif ; limitation de débit (Redis) par IP et par compte sur `/auth/*`.
- Réinitialisation du mot de passe par lien à usage unique (30 min), puis invalidation des sessions.

## 2. Autorisation
- **RBAC à permissions fines** `module.action[.scope]`, avec une **portée par établissement** (`user_properties`).
- Rôles système prédéfinis (non supprimables, clonables) :

| Rôle système | Permissions clés |
|---|---|
| Propriétaire | `*` (y compris l'abonnement, la sécurité et le branding) |
| Admin (prompt) | Tout sauf l'abonnement ; utilisateurs, rôles, sécurité, paramétrage |
| Manager (prompt) | Tout l'opérationnel de ses établissements et départements + rapports + plannings |
| Front Desk (prompt) | `reservations.*`, `front_desk.*`, `guests.*`, `folio.post`, `folio.pay`, `cash.session`, `waitlist.*` |
| Housekeeping (prompt) | `housekeeping.*`, `maintenance.create`, `tasks.update_own`, `inventory.consume` (linge, produits) |
| Restaurant Staff (prompt) | `restaurant.orders.*`, `restaurant.tables.*`, `restaurant.reservations.*`, `folio.charge_room`, `pos.pay` |
| Spa Staff (prompt) | `spa.appointments.*`, `spa.records.read/write` (soins attribués), `folio.charge_room` |
| Maintenance (prompt) | `maintenance.*` (bons affectés), `assets.read`, `inventory.consume` (pièces) |
| Caissier | `folio.pay`, `cash.*` |
| Comptable | `reports.*`, `invoices.read`, `city_ledger.*`, `exports.*` |
| Client (portail) | Son profil, ses réservations, ses demandes, ses factures, ses points (politique `guest_id = self`) |

- Permissions sensibles (toujours auditées, éventuellement soumises à 2FA) : `folio.discount`, `folio.reverse`, `invoice.credit_note`, `cash.close_with_variance`, `pos.void`, `night_audit.run`, `loyalty.adjust`, `spa.records.read`, `hr.timeclock.edit`, `users.manage`, `security.manage`, `billing.manage`, `guests.export`.
- Côté API : middlewares Express `can('reservations.create')` + `requireFeature('spa')` + `subscriptionGuard`. Socket.io : vérifier la permission avant chaque émission ciblée. Côté interface : masquage, jamais comme unique contrôle.
- Le cache des permissions est invalidé via `perm_ver` (incrémenté à chaque changement de rôle).

## 3. Isolation des tenants
Voir doc 03 §4 (RLS + contexte + rooms Socket.io + tests cross-tenant). Fichiers : clés S3 préfixées `t/{tenant_id}/…`, accès uniquement via URL signée (5 min) délivrée après contrôle.

## 4. Impersonation (support)
Elle exige le rôle plateforme `SUPPORT`/`SUPER_ADMIN`, l'autorisation du tenant (`allow_impersonation`), un motif et une durée de 30 min max. Le jeton porte `impersonated_by` ; un bandeau est visible ; certaines actions sont bloquées (changement de mot de passe, sécurité, paiements). Elle est tracée des deux côtés.

## 5. Protection des données
- Données sensibles : pièces d'identité (numéro chiffré, scans en bucket privé chiffré), téléphone, e-mail.
- Conservation paramétrable des fiches de police (par défaut, durée légale locale) ; purge automatique.
- Export des données d'un client (droit d'accès) et anonymisation (droit à l'oubli) sauf obligations légales (factures).
- Journaux sans données sensibles (masquage automatique dans les logs).

## 6. Sécurité applicative (checklist ASVS L2)
En-têtes (CSP stricte, HSTS, X-Frame-Options), CSRF (double-submit sur les cookies), validation Zod sur toutes les entrées, requêtes paramétrées uniquement, upload (type MIME réel, taille, antivirus), SSRF (pas de fetch d'URL utilisateur hors liste blanche), dépendances scannées (Dependabot + `pnpm audit`), secrets en variables d'environnement ou coffre, sauvegardes chiffrées et restauration testée chaque mois, pentest avant la mise en production.

## 7. Audit
Tout événement d'écriture métier, d'authentification, de sécurité et de facturation produit une entrée `audit_logs` (avant/après en diff JSON). Les entrées sont immuables (pas d'UPDATE/DELETE, rôle DB dédié), consultables et exportables par le tenant, avec une rétention de 1 an minimum.
