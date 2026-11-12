import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAdminClient, createAppClient, runWithTenant } from '../src/index.js';
import type { AdminClient, AppClient } from '../src/index.js';
import { createSpaFixture, createTenantFixture } from './fixtures.js';
import type { TenantFixture } from './fixtures.js';

const { adminUrl, appUrl } = inject('pg');

let admin: AdminClient;
let app: AppClient;
let T: TenantFixture;

beforeAll(async () => {
  admin = createAdminClient({ url: adminUrl });
  app = createAppClient({ url: appUrl });
  T = await createTenantFixture(admin, 'C');
});

afterAll(async () => {
  await app?.$disconnect();
  await admin?.$disconnect();
});

describe('anti-overbooking: unit_nights UNIQUE (unit_id, night)', () => {
  it('rejects a second booking of the same unit for the same night', async () => {
    await runWithTenant(T.tenantId, async () => {
      const night = new Date('2026-12-01');
      await app.unitNight.create({
        data: {
          tenantId: T.tenantId,
          unitId: T.room.id,
          night,
          reservationRoomId: T.reservationRoom.id,
        },
      });
      await expect(
        app.unitNight.create({
          data: {
            tenantId: T.tenantId,
            unitId: T.room.id,
            night,
            reservationRoomId: T.reservationRoom.id,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      // next night is fine (departure excluded / arrival included semantics handled by the caller)
      await app.unitNight.create({
        data: {
          tenantId: T.tenantId,
          unitId: T.room.id,
          night: new Date('2026-12-02'),
          reservationRoomId: T.reservationRoom.id,
        },
      });
    });
  });
});

describe('spa: GiST exclusion on appointments', () => {
  it('rejects an overlapping appointment for the same therapist, allows adjacent and cancelled ones', async () => {
    const spa = await createSpaFixture(admin, T);
    const base = {
      tenantId: T.tenantId,
      propertyId: T.propertyId,
      guestId: T.guest.id,
      spaServiceId: spa.spaService.id,
      therapistId: spa.therapist.id,
    };
    await runWithTenant(T.tenantId, async () => {
      await app.appointment.create({
        data: {
          ...base,
          startAt: new Date('2026-12-01T09:00:00Z'),
          endAt: new Date('2026-12-01T10:00:00Z'),
        },
      });
      await expect(
        app.appointment.create({
          data: {
            ...base,
            startAt: new Date('2026-12-01T09:30:00Z'),
            endAt: new Date('2026-12-01T10:30:00Z'),
          },
        }),
      ).rejects.toThrow(/appointments_therapist_no_overlap|exclusion|23P01/i);
      // [start, end) — back-to-back is allowed
      await app.appointment.create({
        data: {
          ...base,
          startAt: new Date('2026-12-01T10:00:00Z'),
          endAt: new Date('2026-12-01T11:00:00Z'),
        },
      });
      // a cancelled appointment does not block the slot
      await app.appointment.create({
        data: {
          ...base,
          status: 'CANCELLED',
          startAt: new Date('2026-12-01T09:15:00Z'),
          endAt: new Date('2026-12-01T09:45:00Z'),
        },
      });
    });
  });

  it('rejects an overlapping appointment in the same treatment room', async () => {
    const spa1 = await createSpaFixture(admin, T);
    const spa2 = await createSpaFixture(admin, T);
    const common = {
      tenantId: T.tenantId,
      propertyId: T.propertyId,
      guestId: T.guest.id,
      treatmentRoomId: spa1.treatmentRoom.id,
    };
    await runWithTenant(T.tenantId, async () => {
      await app.appointment.create({
        data: {
          ...common,
          spaServiceId: spa1.spaService.id,
          therapistId: spa1.therapist.id,
          startAt: new Date('2026-12-02T09:00:00Z'),
          endAt: new Date('2026-12-02T10:00:00Z'),
        },
      });
      await expect(
        app.appointment.create({
          data: {
            ...common,
            spaServiceId: spa2.spaService.id,
            therapistId: spa2.therapist.id,
            startAt: new Date('2026-12-02T09:59:00Z'),
            endAt: new Date('2026-12-02T11:00:00Z'),
          },
        }),
      ).rejects.toThrow(/appointments_treatment_room_no_overlap|exclusion|23P01/i);
    });
  });
});

describe('restaurant: GiST exclusion on table_reservations', () => {
  it('rejects an overlapping reservation of the same table', async () => {
    const outlet = await admin.outlet.create({
      data: {
        tenantId: T.tenantId,
        propertyId: T.propertyId,
        type: 'RESTAURANT',
        name: 'Le Jardin',
      },
    });
    const table = await admin.diningTable.create({
      data: { tenantId: T.tenantId, outletId: outlet.id, number: 'T1', capacity: 4 },
    });
    const data = { tenantId: T.tenantId, outletId: outlet.id, tableId: table.id, partySize: 2 };
    await runWithTenant(T.tenantId, async () => {
      await app.tableReservation.create({
        data: {
          ...data,
          startAt: new Date('2026-12-01T19:00:00Z'),
          endAt: new Date('2026-12-01T21:00:00Z'),
        },
      });
      await expect(
        app.tableReservation.create({
          data: {
            ...data,
            startAt: new Date('2026-12-01T20:00:00Z'),
            endAt: new Date('2026-12-01T22:00:00Z'),
          },
        }),
      ).rejects.toThrow(/table_reservations_table_no_overlap|exclusion|23P01/i);
    });
  });
});

describe('immutability triggers', () => {
  it('rejects UPDATE and DELETE on audit_logs (even for the owner role)', async () => {
    const log = await runWithTenant(T.tenantId, () =>
      app.auditLog.create({
        data: {
          tenantId: T.tenantId,
          action: 'guest.update',
          entity: 'guests',
          entityId: T.guest.id,
        },
      }),
    );
    await runWithTenant(T.tenantId, async () => {
      // hm_app has no UPDATE privilege at all
      await expect(
        app.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } }),
      ).rejects.toThrow();
    });
    await expect(
      admin.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(admin.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/append-only/);
    expect((await admin.auditLog.findUniqueOrThrow({ where: { id: log.id } })).action).toBe(
      'guest.update',
    );
  });

  it('rejects UPDATE/DELETE on folio_lines, loyalty_transactions, stock_movements and platform_audit_logs', async () => {
    await expect(
      admin.folioLine.update({ where: { id: T.folioLine.id }, data: { amount: 1n } }),
    ).rejects.toThrow(/append-only/);
    await expect(admin.folioLine.delete({ where: { id: T.folioLine.id } })).rejects.toThrow(
      /append-only/,
    );

    const program = await admin.loyaltyProgram.create({
      data: { tenantId: T.tenantId, name: 'Club', unitAmount: 1000n, pointValue: 10n },
    });
    const account = await admin.loyaltyAccount.create({
      data: { tenantId: T.tenantId, programId: program.id, guestId: T.guest.id },
    });
    const tx = await admin.loyaltyTransaction.create({
      data: { tenantId: T.tenantId, accountId: account.id, type: 'EARN', points: 25 },
    });
    await expect(
      admin.loyaltyTransaction.update({ where: { id: tx.id }, data: { points: 9999 } }),
    ).rejects.toThrow(/append-only/);

    const wh = await admin.warehouse.create({
      data: { tenantId: T.tenantId, propertyId: T.propertyId, name: 'Central' },
    });
    const item = await admin.inventoryItem.create({
      data: { tenantId: T.tenantId, sku: 'RICE-1', name: 'Riz', unit: 'kg' },
    });
    const mv = await admin.stockMovement.create({
      data: { tenantId: T.tenantId, itemId: item.id, warehouseId: wh.id, type: 'IN', qty: '10.5' },
    });
    await expect(admin.stockMovement.delete({ where: { id: mv.id } })).rejects.toThrow(
      /append-only/,
    );

    const pal = await admin.platformAuditLog.create({
      data: { action: 'tenant.create', entity: 'tenants' },
    });
    await expect(
      admin.platformAuditLog.update({ where: { id: pal.id }, data: { action: 'x' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('folio_payments: only status/reversal columns may change, DELETE is forbidden', async () => {
    const p = await runWithTenant(T.tenantId, () =>
      app.folioPayment.create({
        data: {
          tenantId: T.tenantId,
          propertyId: T.propertyId,
          folioId: T.folio.id,
          amount: 50_000n,
          method: 'CASH',
        },
      }),
    );
    await runWithTenant(T.tenantId, async () => {
      await expect(
        app.folioPayment.update({ where: { id: p.id }, data: { amount: 1n } }),
      ).rejects.toThrow(/may only change/);
      const reversed = await app.folioPayment.update({
        where: { id: p.id },
        data: { status: 'REVERSED', reversalReason: 'erreur de saisie', reversedAt: new Date() },
      });
      expect(reversed.status).toBe('REVERSED');
      await expect(app.folioPayment.delete({ where: { id: p.id } })).rejects.toThrow();
    });
    await expect(admin.folioPayment.delete({ where: { id: p.id } })).rejects.toThrow(
      /DELETE .* forbidden/,
    );
  });
});

describe('platform payments: UNIQUE (method, reference) WHERE reference IS NOT NULL AND status <> REVERSED', () => {
  const pay = (reference: string | null, method: 'MIXX' | 'MOOV_MONEY' = 'MIXX') =>
    admin.payment.create({
      data: {
        tenantId: T.tenantId,
        amount: 15_000n,
        method,
        reference,
        paidAt: new Date('2026-11-10'),
        status: 'CONFIRMED',
      },
    });

  it('rejects a duplicate reference for the same method', async () => {
    const first = await pay('MX-0001');
    await expect(pay('MX-0001')).rejects.toMatchObject({ code: 'P2002' });
    // same reference with another method is fine; NULL references never collide
    await pay('MX-0001', 'MOOV_MONEY');
    await pay(null);
    await pay(null);
    // once reversed, the reference can be reused
    await admin.payment.update({
      where: { id: first.id },
      data: { status: 'REVERSED', reversalReason: 'doublon' },
    });
    await pay('MX-0001');
  });

  it('payments: amount is immutable, status may change', async () => {
    const p = await pay('MX-0002');
    await expect(
      admin.payment.update({ where: { id: p.id }, data: { amount: 1n } }),
    ).rejects.toThrow(/may only change/);
    await expect(admin.payment.delete({ where: { id: p.id } })).rejects.toThrow(/forbidden/);
  });
});
