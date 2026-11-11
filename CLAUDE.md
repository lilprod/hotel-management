# Conventions projet (à lire par tout agent)

- Langue du code : anglais. Langue de l'interface et des documents : FR (+ EN via i18next).
- Monorepo pnpm/Turborepo : `client` (staff), `portal` (clients), `admin` (Super Admin), `server`, `database`, `packages/{shared,ui,config}`.
- Stack figée : React 18 + Vite + TypeScript, Ant Design 5, Zustand, TanStack Query, React Hook Form + Zod, Recharts, FullCalendar ; Express + TypeScript, Zod, Prisma, PostgreSQL 16, BullMQ (pas de node-cron), Socket.io + adapter Redis, Winston, Helmet. Aucune alternative sans accord de l'orchestrateur.
- Backend découpé par module : `server/src/modules/<m>/{routes,controller,service,repository,schemas,events}.ts`.
- Ne lire que les documents cités dans la fiche de mission (`docs/0X §Y`). Ne pas modifier `database/prisma/schema.prisma` ni `packages/shared` hors lot L0 sans accord.
- Multi-tenancy : toute table métier a `tenant_id` + RLS. Le `tenant_id` vient toujours du contexte (AsyncLocalStorage), jamais du client. Rooms Socket.io jointes côté serveur uniquement.
- Montants : entiers + devise (XOF par défaut). Jamais de float.
- Nuits : `DATE`, arrivée incluse, départ exclu.
- Documents financiers, points de fidélité, mouvements de stock et audit immuables : corriger par contre-passation ou avoir.
- API : `/api/v1/admin/*` (plateforme), `/api/v1/t/*` (staff), `/api/v1/portal/*` (clients) ; validation Zod ; erreurs RFC 7807 ; `can()` + `requireFeature()` sur chaque route tenant.
- Tests obligatoires : règles métier + cross-tenant + permission refusée.
- Vérification avant rendu : `pnpm lint && pnpm typecheck && pnpm test --filter <pkg>`.
- Rendu d'un agent : résumé ≤ 15 lignes (fichiers, décisions, points ouverts), sans code.
