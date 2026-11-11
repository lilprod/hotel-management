# 02 — Plans, abonnements et facturation manuelle

## 1. Matrice des plans (valeurs par défaut, toutes paramétrables par le Super Admin)

| | **Standard** | **Medium** | **Premium** |
|---|---|---|---|
| Prix mensuel (XOF, indicatif) | 25 000 | 50 000 | 100 000 |
| Remise trimestrielle / annuelle | 5 % / 15 % | 5 % / 15 % | 5 % / 15 % |
| Essai gratuit | 14 j | 14 j | 30 j |
| Établissements | 1 | 2 | Illimité |
| Chambres (total) | 20 | 60 | Illimité |
| Utilisateurs | 5 | 15 | Illimité |
| Stockage | 1 Go | 5 Go | 20 Go |
| SMS inclus par mois | 0 | 200 | 1 000 |
| PMS cœur (planning, réservations, réception, folio, caisse, housekeeping, audit de nuit, CRM, rapports de base) | ✅ | ✅ | ✅ |
| Rôles personnalisés | ❌ (rôles prédéfinis) | ✅ | ✅ |
| 2FA, politiques de mot de passe et de session | ✅ | ✅ | ✅ |
| Restriction IP / horaires | ❌ | ✅ | ✅ |
| Branding (logo, couleurs, documents) | ✅ | ✅ | ✅ |
| Domaine personnalisé | ❌ | ❌ | ✅ |
| Maintenance (tickets) | ✅ | ✅ | ✅ |
| POS restaurant/bar | ❌ | ✅ | ✅ |
| Stocks | ❌ | ✅ | ✅ |
| Groupes et comptes débiteurs | ❌ | ✅ | ✅ |
| Rapports avancés et exports programmés | ❌ | Partiel | ✅ |
| API et webhooks, SSO (P2) | ❌ | ❌ | ✅ |
| Moteur de réservation en ligne (P2) | ❌ | ✅ | ✅ |
| Support | E-mail | E-mail + WhatsApp | Prioritaire |

Codes des fonctionnalités (`feature_key`) : `pms.core`, `security.custom_roles`, `security.ip_restriction`, `branding.custom_domain`, `pos`, `inventory`, `groups`, `city_ledger`, `reports.advanced`, `reports.scheduled`, `api`, `sso`, `booking_engine`, `sms`.
Codes des quotas (`quota_key`) : `properties`, `rooms`, `users`, `storage_mb`, `sms_per_month`.

**Règle d'application** : `PlanGuard` / `@RequiresFeature('pos')` côté API, et masquage dans l'interface (menu grisé avec CTA « Passer au plan Medium »). Les quotas sont vérifiés **à la création** (chambres, utilisateurs, établissements), jamais rétroactivement.

## 2. Cycle de vie d'un abonnement

```
          inscription
               │
               ▼
   ┌────── TRIALING ──────┐  paiement validé
   │   (N jours du plan)  ├───────────────────┐
   │                      │                   ▼
   │ fin d'essai          │               ACTIVE ◄────────────┐
   ▼ sans paiement        │                   │ échéance        │ paiement
SUSPENDED ◄───────────────┘                   │ non payée       │ validé
(lecture seule)                               ▼                 │
   │  ▲                                    PAST_DUE ────────────┘
   │  └──── fin de grâce (G jours, déf. 7) ─────┘
   │
   │ suspension > R jours (déf. 90) ou résiliation
   ▼
CANCELLED ──► (après la période de rétention) PURGED
```

| Statut | Accès tenant | Remarques |
|---|---|---|
| `TRIALING` | Complet (fonctionnalités du plan choisi) | Bandeau « Essai : X jours restants » |
| `ACTIVE` | Complet | — |
| `PAST_DUE` | Complet + bandeau rouge | Relances J0, J+3, J+7 |
| `SUSPENDED` | **Lecture seule** + export + page de paiement | Aucune écriture opérationnelle |
| `CANCELLED` | Connexion limitée à l'export des données | Purge planifiée |

Transitions exécutées par un **job planifié quotidien** (00:15, fuseau du tenant) et par les événements de paiement. Chaque transition est tracée (`subscription_events`).

## 3. Factures plateforme
- Générées à la souscription, à chaque renouvellement (J-7 avant l'échéance) et lors d'un *upgrade* (prorata = `(prix_nouveau − prix_ancien) × jours_restants / jours_période`).
- Numérotation `PLT-{AAAA}-{000001}` (séquence transactionnelle, sans trou).
- Statuts : `DRAFT` → `OPEN` → `PARTIALLY_PAID` → `PAID` ; `VOID` (annulée par avoir).
- Montants en entiers (unité minimale de la devise ; XOF = 0 décimale).

## 4. Enregistrement manuel d'un paiement (Super Admin)

### 4.1 Champs
| Champ | Type | Obligatoire | Règle |
|---|---|---|---|
| tenant | ref | ✅ | — |
| amount | integer | ✅ | > 0 |
| currency | ISO 4217 | ✅ | défaut XOF |
| method | enum | ✅ | `MIXX`, `MOOV_MONEY`, `CASH`, `CARD` |
| reference | string(100) | ❌ | Unique par (`method`, `reference`) si renseignée ; format libre (ex. ID de transaction Mixx, ticket TPE) |
| paid_at | date | ✅ | ≤ aujourd'hui |
| attachment | fichier | ❌ | Image ou PDF, ≤ 5 Mo |
| allocations | liste (facture, montant) | ✅ | Σ ≤ amount ; le reste éventuel devient un **crédit** du tenant |
| note | texte | ❌ | — |
| status | enum | auto | `PENDING_VALIDATION` (si double validation activée) → `CONFIRMED` ; `REVERSED` |

### 4.2 Effets d'une confirmation (transaction unique)
1. Mise à jour du statut des factures imputées.
2. Si l'abonnement est `TRIALING`, `PAST_DUE` ou `SUSPENDED` et que la facture de période est soldée → `ACTIVE`, `current_period_end` prolongée.
3. Génération du **reçu** `REC-{AAAA}-{000001}` (PDF) et envoi par e-mail/SMS.
4. Écriture dans l'audit plateforme et événement `payment.confirmed` (outbox).

### 4.3 Annulation (contre-passation)
Statut `REVERSED` avec motif. Les allocations sont annulées, les factures réouvertes, l'abonnement est réévalué par le job, et un reçu d'annulation est émis.

### 4.4 Déclaration de paiement par le tenant (TN-31)
Même formulaire, côté tenant → `payment_declarations` au statut `SUBMITTED`. Le Super Admin **valide** (cela crée un `payment` `CONFIRMED`) ou **rejette** (motif notifié au tenant).

### 4.5 Préparation de l'agrégateur futur
```ts
interface PaymentProvider {
  code: 'manual' | 'cinetpay' | 'fedapay' | ...;
  initiate(invoice: Invoice): Promise<PaymentIntent>;   // manual : renvoie les instructions
  handleWebhook?(req): Promise<PaymentResult>;          // non implémenté en v1
}
```
Le modèle `payments` contient déjà `provider` (défaut `manual`) et `provider_payload` (JSONB, nullable).

## 5. Relances (paramétrables)
| Moment | Canal | Modèle |
|---|---|---|
| Fin d'essai J-3, J-1 | E-mail + bandeau | `trial_ending` |
| Échéance J-7, J-3 | E-mail (+ SMS si activé) | `invoice_upcoming` |
| J0 | E-mail + SMS + bandeau | `invoice_due` |
| J+3, J+7 | E-mail + SMS | `invoice_overdue` |
| Suspension | E-mail + SMS | `account_suspended` |
