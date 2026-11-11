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
| `unit_nights` | tenant_id, unit_id (= `rooms.id`), night, reservation_room_id — **UNIQUE (unit_id, night)** |
| `waitlist_entries` | property_id, guest_id, room_type_id, arrival, departure, adults, children, status (`WAITING`/`OFFERED`/`ACCEPTED`/`EXPIRED`/`CANCELLED`), offered_at, offer_expires_at, priority |
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

## 3 bis. Modules du prompt « complexe touristique » (RLS)

Remarques :
- `rooms` désigne toute **unité** (chambre, suite, villa, bungalow).
- `reservations` est le **dossier** multi-services : statut `PENDING` (avec `pending_expires_at`), `CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `COMPLETED`, `CANCELLED`, `NO_SHOW`, et colonne `channel` (`FRONT_DESK`/`PORTAL`/`PHONE`/`AGENCY`).

| Domaine | Table | Colonnes principales |
|---|---|---|
| Portail | `guest_accounts` | tenant_id, guest_id, email, password_hash, email_verified_at, locale, last_login_at — UNIQUE (tenant_id, email) |
| Portail | `guest_requests` | stay_id, guest_id, type (`ROOM_SERVICE`/`AMENITY`/`MAINTENANCE`/`OTHER`), details, status, handled_by, linked_order_id / maintenance_request_id |
| Portail | `deposit_declarations` | reservation_id, amount, method (`MIXX`/`MOOV_MONEY`/`BANK_TRANSFER`), reference, attachment_file_id, status (`SUBMITTED`/`APPROVED`/`REJECTED`), reviewed_by, folio_payment_id |
| CRM | `guest_preferences` | guest_id, key, value |
| CRM | `communications` | guest_id, channel (`EMAIL`/`SMS`/`WHATSAPP`/`PHONE`/`NOTE`), direction, subject, body, template_code, sent_at, user_id |
| CRM | `consents` | guest_id, purpose (`MARKETING`/`PROFILING`), granted, at, source |
| Fidélité | `loyalty_programs` | tenant_id, points_per_unit (ex. 1 pt / 1 000 XOF), point_value, expiry_months, rules (JSONB par département) |
| Fidélité | `loyalty_tiers` | program_id, code, name, min_points, discount_percent, perks (JSONB) |
| Fidélité | `loyalty_accounts` | guest_id, tier_id, balance, lifetime_points |
| Fidélité | `loyalty_transactions` | account_id, type (`EARN`/`REDEEM`/`EXPIRE`/`ADJUST`/`REVERSAL`), points, source_type, source_id, expires_at, user_id — **immuable** |
| RH | `departments` | property_id, code (`FRONT_DESK`/`HOUSEKEEPING`/`RESTAURANT`/`SPA`/`MAINTENANCE`/`ADMIN`…), name |
| RH | `employees` | tenant_id, user_id (nullable), department_id, position, hire_date, contract_type, phone, emergency_contact, pin_hash, skills[] |
| RH | `shift_templates` | department_id, name, start_time, end_time, break_minutes |
| RH | `staff_schedules` | employee_id, date, start_at, end_at, shift_template_id, status (`DRAFT`/`PUBLISHED`), note |
| RH | `time_entries` | employee_id, clock_in_at, clock_out_at, source (`WEB`/`KIOSK`), schedule_id, anomaly |
| RH | `leaves` | employee_id, type, from_date, to_date, status |
| Tâches | `tasks` | property_id, title, description, department_id, assigned_to, due_at, priority, status, proof_file_ids[], source_type, source_id |
| Messagerie | `conversations`, `conversation_members`, `messages` | type (`DIRECT`/`DEPARTMENT`) ; message : sender_id, body, file_ids[], read_by |
| Notifications | `notifications` | user_id, type, title, body, link, read_at ; `notification_preferences` (user_id, type, channels) |
| Restaurant | `outlets` | property_id, type (`RESTAURANT`/`BAR`/`ROOM_SERVICE`), name, opening_hours |
| Restaurant | `floor_plans`, `dining_tables` | outlet_id ; table : number, zone, capacity, pos_x, pos_y, shape, status |
| Restaurant | `menu_categories`, `menu_items` | outlet_id ; item : name_i18n, price, tax_id, dietary_tags[] (`VEGAN`/`VEGETARIAN`/`HALAL`/`GLUTEN_FREE`…), allergens[], photo_file_id, is_available, recipe_id |
| Restaurant | `daily_specials` | outlet_id, menu_item_id, from_date, to_date, special_price |
| Restaurant | `orders`, `order_items` | outlet_id, table_id, room_id, stay_id, folio_id, waiter_id, type (`DINE_IN`/`ROOM`/`TAKEAWAY`), status (`OPEN`/`SENT`/`SERVED`/`PAID`/`CHARGED_TO_ROOM`/`VOID`), totals ; item : qty, unit_price, modifiers, status, void_reason |
| Restaurant | `table_reservations` | outlet_id, reservation_id (nullable), guest_id, party_size, start_at, end_at, table_id, is_resident, status |
| Spa | `spa_services` | property_id, name_i18n, category, duration_min, buffer_min, price, tax_id, required_skill, room_type_required, recipe_id |
| Spa | `therapists` | employee_id, skills[], gender |
| Spa | `treatment_rooms` | property_id, name, capabilities[] |
| Spa | `appointments` | reservation_id (nullable), guest_id, spa_service_id, therapist_id, treatment_room_id, start_at, end_at, status, preferences (JSONB), folio_id — **EXCLUDE GiST** sur (therapist_id, tstzrange) et (treatment_room_id, tstzrange) |
| Spa | `treatment_records` | appointment_id, guest_id, therapist_notes, contraindications (accès restreint `spa.records`) |
| Forfaits | `packages`, `package_components` | name_i18n, price, valid_from/to ; composants : type (`ROOM_NIGHT`/`SPA`/`MEAL`/`ACTIVITY`), ref_id, qty, revenue_share |
| Activités | `activities`, `activity_slots`, `activity_bookings` | activity : name_i18n, price_per_person, capacity, guide_employee_id ; slot : start_at, end_at, capacity, booked ; réservation : slot_id, guest_id, participants, status, folio_id |
| Stocks | `warehouses` | property_id, department_id, name |
| Stocks | `inventory_items` | tenant_id, sku, name, unit, category, min_qty, reorder_qty, avg_cost, supplier_id, lead_time_days |
| Stocks | `stock_levels` | item_id, warehouse_id, qty |
| Stocks | `stock_movements` | item_id, warehouse_id, type (`IN`/`OUT`/`TRANSFER`/`LOSS`/`CONSUMPTION`/`ADJUST`), qty, unit_cost, source_type, source_id — **immuable** |
| Stocks | `recipes`, `recipe_lines` | (menu ou soin) → item_id, qty |
| Stocks | `suppliers`, `purchase_orders`, `purchase_order_lines`, `goods_receipts` | PO : status (`DRAFT`/`SENT`/`PARTIAL`/`RECEIVED`/`CANCELLED`) |
| Stocks | `reorder_suggestions` | item_id, warehouse_id, suggested_qty, reason, generated_at, status |
| Maintenance | `assets` | property_id, room_id (nullable), name, category, serial, install_date |
| Maintenance | `maintenance_requests` | property_id, room_id, asset_id, source (`STAFF`/`GUEST`/`AUTO`/`PREVENTIVE`), title, description, priority (`URGENT`/`HIGH`/`NORMAL`/`LOW`), status, photos[], blocks_room |
| Maintenance | `work_orders` | request_id, assigned_to, started_at, completed_at, labor_minutes, parts (lien `stock_movements`), resolution |
| Maintenance | `preventive_plans` | asset_id / room_id, title, frequency_type (`DAYS`/`MONTHS`/`OCCUPIED_NIGHTS`), frequency_value, last_generated_at, next_due_at |
| Maintenance | `room_status_history` | room_id, from_status, to_status, at, user_id, reason |

Ajouts aux tables existantes :
- `folio_payments.method` accepte aussi `LOYALTY_POINTS`.
- `folio_lines.type` accepte aussi `SPA`, `ACTIVITY`, `PACKAGE`, `MINIBAR`, `PENALTY`.
- `folio_lines.department_code` sert aux rapports de chiffre d'affaires par département.

## 4. Index et contraintes notables
- `UNIQUE (tenant_id, property_id, number)` sur les chambres, réservations, factures et folios.
- `UNIQUE (unit_id, night)` sur `unit_nights` (anti-surbooking).
- Contraintes d'exclusion GiST (`btree_gist`) sur `appointments` (praticien, cabine) et `table_reservations` (table).
- Index `(tenant_id, guest_id)` sur toutes les tables d'historique client ; `(tenant_id, status, priority)` sur `maintenance_requests` ; `(item_id, warehouse_id)` sur `stock_levels`.
- Les tables de correspondance avec le prompt : `users`, `clients` → `guests` (+ `guest_accounts`), `rooms`, `reservations`, `services` → `spa_services` / `activities` / `products`, `appointments`, `orders`, `inventory_items`, `maintenance_requests`, `invoices`, `staff_schedules` : toutes présentes.
- Index `(tenant_id, property_id, arrival)` et `(tenant_id, property_id, departure)` sur `reservation_rooms`.
- Chiffrement applicatif (AES-256-GCM, clé par tenant dérivée d'une KMS) de `id_doc_number_enc` et `totp_secret_enc`.
