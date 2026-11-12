import { defineConfig } from 'prisma/config';

// Migrations always run with the owner/admin role (bypasses RLS, owns the objects).
// `prisma generate` / `prisma validate` do not need a reachable database.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL_ADMIN ?? 'postgresql://localhost:5432/hm',
  },
});
