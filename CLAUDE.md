# Conventions projet (à lire par tout agent)

- Langue du code : anglais. Langue de l'interface et des documents : FR (+ EN via i18n).
- Monorepo pnpm/Turborepo : `apps/{api,web-tenant,web-admin,worker}`, `packages/{db,contracts,ui,config,pdf-templates}`.
- Ne lire que les documents référencés dans la fiche de mission (`docs/0X §Y`). Ne pas modifier `packages/db` ni `packages/contracts` hors lot L0 sans accord de l'orchestrateur.
- Multi-tenancy : toute table métier a `tenant_id` + RLS. Ne jamais passer `tenant_id` depuis le client : il vient du contexte (`TenantContext`).
- Montants : entiers (`bigint`) + devise ; XOF par défaut. Jamais de `float`.
- Nuits : `DATE`, arrivée inclusive, départ exclusive.
- Documents financiers (factures, paiements, encaissements, audit) immuables : corriger par contre-passation ou avoir.
- API : `/api/v1/admin/*` (plateforme), `/api/v1/t/*` (tenant) ; validation Zod ; erreurs RFC 7807 ; `@Can(...)`, `@RequiresFeature(...)` sur chaque route tenant.
- Tests obligatoires : règles métier + cross-tenant + permission refusée.
- Vérification avant rendu : `pnpm lint && pnpm typecheck && pnpm test --filter <pkg>`.
- Rendu d'un agent : résumé ≤ 15 lignes (fichiers, décisions, points ouverts), sans code.
