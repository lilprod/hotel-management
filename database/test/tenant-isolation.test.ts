import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  PrismaClient,
  TenantContextError,
  createAdminClient,
  createAppClient,
  getTenantId,
  runWithTenant,
} from '../src/index.js';
import type { AdminClient, AppClient } from '../src/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createTenantFixture } from './fixtures.js';
import type { TenantFixture } from './fixtures.js';

const { adminUrl, appUrl } = inject('pg');

let admin: AdminClient;
let app: AppClient;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  admin = createAdminClient({ url: adminUrl });
  app = createAppClient({ url: appUrl });
  A = await createTenantFixture(admin, 'A');
  B = await createTenantFixture(admin, 'B');
});

afterAll(async () => {
  await app?.$disconnect();
  await admin?.$disconnect();
});

describe('tenant isolation through the app client (RLS)', () => {
  it('reads only the rows of the current tenant', async () => {
    await runWithTenant(A.tenantId, async () => {
      const guests = await app.guest.findMany();
      expect(guests.map((g) => g.id)).toEqual([A.guest.id]);

      const reservations = await app.reservation.findMany();
      expect(reservations.map((r) => r.id)).toEqual([A.reservation.id]);

      const lines = await app.folioLine.findMany();
      expect(lines.map((l) => l.id)).toEqual([A.folioLine.id]);

      expect(await app.room.count()).toBe(1);
      expect(await app.tenant.findMany().catch((e: unknown) => e)).toBeInstanceOf(Error); // no grant on platform table
    });
  });

  it('cannot read a row of another tenant even by primary key', async () => {
    await runWithTenant(A.tenantId, async () => {
      expect(await app.guest.findUnique({ where: { id: B.guest.id } })).toBeNull();
      expect(await app.reservation.findFirst({ where: { id: B.reservation.id } })).toBeNull();
      expect(await app.folioLine.findUnique({ where: { id: B.folioLine.id } })).toBeNull();
      const raw = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM guests`;
      expect(raw[0]?.n).toBe(1n);
    });
  });

  it('cannot update or delete rows of another tenant', async () => {
    await runWithTenant(A.tenantId, async () => {
      const upd = await app.guest.updateMany({
        where: { id: B.guest.id },
        data: { notes: 'hacked' },
      });
      expect(upd.count).toBe(0);
      await expect(
        app.guest.update({ where: { id: B.guest.id }, data: { notes: 'hacked' } }),
      ).rejects.toThrow();
      const updRes = await app.reservation.updateMany({
        where: { id: B.reservation.id },
        data: { notes: 'hacked' },
      });
      expect(updRes.count).toBe(0);
      const del = await app.reservation.deleteMany({ where: { id: B.reservation.id } });
      expect(del.count).toBe(0);
      const rawUpd =
        await app.$executeRaw`UPDATE guests SET notes = 'hacked' WHERE id = ${B.guest.id}::uuid`;
      expect(rawUpd).toBe(0);
    });
    const b = await admin.guest.findUniqueOrThrow({ where: { id: B.guest.id } });
    expect(b.notes).toBeNull();
    expect(await admin.reservation.count({ where: { id: B.reservation.id } })).toBe(1);
  });

  it('cannot insert a row for another tenant (WITH CHECK)', async () => {
    await runWithTenant(A.tenantId, async () => {
      await expect(
        app.guest.create({ data: { tenantId: B.tenantId, firstName: 'X', lastName: 'Intruder' } }),
      ).rejects.toThrow(/row-level security|42501/i);
      // own tenant works
      const g = await app.guest.create({
        data: { tenantId: A.tenantId, firstName: 'Kofi', lastName: 'Own' },
      });
      expect(g.tenantId).toBe(A.tenantId);
      await app.guest.delete({ where: { id: g.id } });
    });
  });

  it('scopes interactive transactions to the tenant', async () => {
    const ids = await runWithTenant(B.tenantId, () =>
      app.$transaction(async (tx) => {
        const rows = await tx.guest.findMany({ select: { id: true } });
        const tenant = await tx.$queryRaw<
          { t: string }[]
        >`SELECT current_setting('app.tenant_id', true) AS t`;
        return { rows: rows.map((r) => r.id), tenant: tenant[0]?.t };
      }),
    );
    expect(ids).toEqual({ rows: [B.guest.id], tenant: B.tenantId });
  });

  it('keeps contexts separate across concurrent requests', async () => {
    const [a, b] = await Promise.all([
      runWithTenant(A.tenantId, () => app.guest.findMany({ select: { id: true } })),
      runWithTenant(B.tenantId, () => app.guest.findMany({ select: { id: true } })),
    ]);
    expect(a.map((g) => g.id)).toEqual([A.guest.id]);
    expect(b.map((g) => g.id)).toEqual([B.guest.id]);
  });
});

describe('missing tenant context', () => {
  it('throws TenantContextError for model, raw and transaction operations', async () => {
    expect(getTenantId()).toBeUndefined();
    await expect(app.guest.findMany()).rejects.toBeInstanceOf(TenantContextError);
    await expect(app.$queryRaw`SELECT 1`).rejects.toBeInstanceOf(TenantContextError);
    await expect(app.$transaction(async (tx) => tx.guest.count())).rejects.toBeInstanceOf(
      TenantContextError,
    );
  });

  it('rejects an invalid tenant id', () => {
    expect(() => runWithTenant('not-a-uuid', () => 1)).toThrow(TenantContextError);
  });

  it('fails closed at the database level: hm_app without app.tenant_id sees nothing', async () => {
    const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: appUrl }) });
    try {
      expect(await raw.guest.count()).toBe(0);
      expect(await raw.folioLine.count()).toBe(0);
      await expect(
        raw.guest.create({ data: { tenantId: A.tenantId, firstName: 'N', lastName: 'Ctx' } }),
      ).rejects.toThrow();
    } finally {
      await raw.$disconnect();
    }
  });

  it('the admin client bypasses RLS', async () => {
    expect(await admin.guest.count({ where: { id: { in: [A.guest.id, B.guest.id] } } })).toBe(2);
  });
});
