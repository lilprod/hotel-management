# 04 — Modèle de données (logique)

Conventions : PK `id UUID v7`, `created_at`, `updated_at`, `created_by`. Toute table métier tenant a `tenant_id` (FK + RLS) et, si pertinent, `property_id`. Montants en `BIGINT` + `currency CHAR(3)`. Suppression logique (`deleted_at`) uniquement pour les référentiels.

## 1. Plateforme (sans RLS — accès admin uniquement)
| Table | Colonnes principales |
|---|---|
| `platform_users` | email, password_hash, name, role (`SUPER_ADMIN`/`FINANCE`/`SUPPORT`/`READ_ONLY`), totp_secret_enc, is_active, last_login_at |
| `plans` | code (`STANDARD`/`MEDIUM`/`PREMIUM`), name, description, trial_days, sort, is_public, is_active |
| `plan_prices` | plan_id, billing_cycle (`MONTHLY`/`QUARTERLY`/`YEARLY`), currency, amount, valid_from, valid_to |
| `plan_features` | plan_id, feature_key, enabled |
| `plan_quotas` | plan_id, quota_key, limit (NULL = illimité) |
| `tenants` | slug (unique), name, legal_name, country, phone, email, status, default_locale, default_currency, timezone, allow_impersonation, notes, tags |
| `tenant_domains` | tenant_id, hostname (unique), type (`SUBDOMAIN`/`CUSTOM`), verified_at, tls_status |
| `tenant_overrides` | tenant_id, kind (`FEATURE`/`QUOTA`/`DISCOUNT`), key, value, ends_at |
| `subscriptions` | tenant_id, plan_id, billing_cycle, status (`TRIALING`/`ACTIVE`/`PAST_DUE`/`SUSPENDED`/`CANCELLED`), trial_ends_at, current_period_start, current_period_end, grace_ends_at, cancel_at, price_snapshot |
| `subscription_events` | subscription_id, from_status, to_status, reason, actor |
| `platform_invoices` | tenant_id, subscription_id, number (unique), issue_date, due_date, period_start, period_end, subtotal, tax, total, amount_paid, status, pdf_file_id |
| `platform_invoice_lines` | invoice_id, label, qty, unit_amount, amount |
| `payments` | tenant_id, amount, currency, method (`MIXX`/`MOOV_MONEY`/`CASH`/`CARD`), reference, paid_at, status (`PENDING_VALIDATION`/`CONFIRMED`/`REVERSED`), provider (défaut `manual`), provider_payload, attachment_file_id, note, recorded_by, validated_by, reversed_by, reversal_reason, receipt_number. **UNIQUE (method, reference) WHERE reference IS NOT NULL AND status <> 'REVERSED'** |
| `payment_allocations` | payment_id, invoice_id, amount |
| `tenant_credits` | tenant_id, amount, source_payment_id, consumed_amount |
| `payment_declarations` | tenant_id, amount, method, reference, paid_at, attachment_file_id, status (`SUBMITTED`/`APPROVED`/`REJECTED`), reviewed_by, reject_reason, payment_id |
| `platform_settings` | key, value (JSONB) — infos de facturation, instructions de paiement, délais de grâce et de purge, relances |
| `announcements`, `support_tickets`, `support_messages` | — |
| `platform_audit_logs` | actor_id, action, entity, entity_id, before, after, ip, user_agent, at |
| `sequences` | scope (`platform` ou `tenant_id:property_id`), key, year, next_value |

## 2. Tenant — IAM, sécurité et branding (RLS)
| Table | Colonnes principales |
|---|---|
| `users` | tenant_id, email, phone, name, password_hash, status, totp_secret_enc, must_change_password, failed_attempts, locked_until, last_login_at |
| `user_properties` | user_id, property_id |
| `roles` | tenant_id, name, is_system, description |
| `role_permissions` | role_id, permission_key (ex. `reservations.create`) |
| `user_roles` | user_id, role_id |
| `security_policies` | tenant_id, pwd_min_length, pwd_require_classes, pwd_expiry_days, pwd_history, mfa_mode (`OFF`/`OPTIONAL`/`REQUIRED_FOR_ROLES`/`REQUIRED_ALL`), mfa_roles, session_idle_minutes, max_sessions, lockout_threshold, lockout_minutes, ip_allowlist (CIDR[]), allow_impersonation |
| `sessions` | user_id, refresh_hash, ip, user_agent, expires_at, revoked_at |
| `audit_logs` | tenant_id, user_id, impersonated_by, action, entity, entity_id, before, after, ip, at (partitionnée par mois) |
| `branding` | tenant_id, logo_file_id, logo_dark_file_id, favicon_file_id, primary_color, secondary_color, login_bg_file_id, login_message, doc_header, doc_footer, legal_mentions, signature_file_id, email_sender_name |
| `message_templates` | tenant_id, channel, code, locale, subject, body |

## 3. Tenant — opérationnel (RLS)
| Table | Colonnes principales |
|---|---|
| `properties` | tenant_id, name, address, city, country, phone, email, tax_id, rccm, currency, timezone, checkin_time, checkout_time, business_date |
| `room_types` | property_id, code, name, max_adults, max_children, base_occupancy, beds, size_m2, amenities[], photos[] |
| `rooms` | property_id, room_type_id, number, floor, building, hk_status, is_active, features[] |
| `room_blocks` | room_id, from_date, to_date, reason (`MAINTENANCE`/`OUT_OF_SERVICE`) |
| `taxes` | property_id, code, name, type (`PERCENT`/`FIXED_PER_PERSON_NIGHT`/`FIXED_PER_NIGHT`), value, inclusive, applies_to |
| `rate_plans` | property_id, code, name, meal_plan (`RO`/`BB`/`HB`/`FB`), cancellation_policy_id, is_public, company_id |
| `seasons` | property_id, name, from_date, to_date, priority |
| `rates` | rate_plan_id, room_type_id, season_id, dow_mask, price, extra_adult, extra_child, min_stay |
| `policies` | property_id, kind (`CANCELLATION`/`DEPOSIT`), rules (JSONB) |
| `guests` | tenant_id, first_name, last_name, gender, birth_date, birth_place, nationality, profession, phone, email, address, id_doc_type, id_doc_number_enc, id_doc_file_id, tags[], is_blacklisted, notes |
| `companies` | tenant_id, name, tax_id, address, contact, credit_limit, rate_plan_id |
| `reservations` | property_id, number, status, source, segment, booker_guest_id, company_id, group_id, arrival, departure, adults, children, notes, option_expires_at, cancelled_at, cancel_reason |
| `reservation_rooms` | reservation_id, room_type_id, room_id (nullable jusqu'à l'affectation), rate_plan_id, arrival, departure, status, daily_prices (JSONB) |
| `room_nights` | tenant_id, room_id, night, reservation_room_id — **UNIQUE (room_id, night)** |
| `reservation_guests` | reservation_room_id, guest_id, is_primary |
| `groups` | property_id, name, company_id, master_folio_id |
| `stays` | reservation_room_id, checked_in_at, checked_in_by, checked_out_at, checked_out_by |
| `police_records` | stay_id, guest_id, snapshot (JSONB : pièce, provenance, destination, motif), signature_file_id |
| `folios` | property_id, stay_id / group_id / company_id, number, status (`OPEN`/`CLOSED`), balance |
| `folio_lines` | folio_id, business_date, type (`ROOM`/`EXTRA`/`POS`/`TAX`/`DISCOUNT`/`ADJUSTMENT`), product_id, label, qty, unit_amount, amount, tax_amount, reversal_of_id, pos_order_id |
| `invoices` | property_id, folio_id, number, issue_date, customer_snapshot, totals, status, credit_note_of_id, pdf_file_id |
| `receipts_payments` (`folio_payments`) | folio_id, amount, method (`MIXX`/`MOOV_MONEY`/`CASH`/`CARD`/`BANK_TRANSFER`/`CITY_LEDGER`), reference, cash_session_id, is_deposit, reversed_by_id |
| `cash_sessions` | property_id, user_id, opened_at, opening_float, closed_at, counted_amount, expected_amount, variance, note |
| `cash_movements` | cash_session_id, type (`IN`/`OUT`), amount, reason |
| `night_audits` | property_id, business_date, started_by, completed_at, summary (JSONB) |
| `hk_tasks` | property_id, room_id, date, assigned_to, type, status, notes |
| `maintenance_tickets` | property_id, room_id, title, description, priority, status, assigned_to, photos[], blocks_room |
| `products` | property_id, category_id, name, price, tax_id, is_stock_item, stock_item_id |
| `outlets` (POS) | property_id, name, type |
| `pos_orders`, `pos_order_lines` | outlet_id, table, room_id, folio_id, status, totals ; lignes |
| `stock_items`, `warehouses`, `stock_movements`, `stock_counts` | — |
| `suppliers`, `purchase_orders` | (S) |
| `files` | tenant_id, key, mime, size, checksum, is_sensitive |
| `outbox_events` | tenant_id, type, payload, processed_at |

## 4. Index et contraintes notables
- `UNIQUE (tenant_id, property_id, number)` sur les chambres, réservations, factures et folios.
- `UNIQUE (room_id, night)` sur `room_nights` (anti-double-booking).
- Index `(tenant_id, property_id, arrival)` et `(tenant_id, property_id, departure)` sur `reservation_rooms`.
- Chiffrement applicatif (AES-256-GCM, clé par tenant dérivée d'une KMS) de `id_doc_number_enc` et `totp_secret_enc`.
