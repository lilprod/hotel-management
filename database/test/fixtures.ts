/**
 * Minimal reusable fixtures, created with the admin client (bypasses RLS).
 */
import type { AdminClient } from '../src/index.js';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function createTenantFixture(admin: AdminClient, label = 'T') {
  const u = uniq();
  const tenant = await admin.tenant.create({
    data: {
      slug: `${label.toLowerCase()}-${u}`,
      name: `Hotel ${label}`,
      country: 'TG',
      timezone: 'Africa/Lome',
    },
  });
  const tenantId = tenant.id;
  const property = await admin.property.create({
    data: {
      tenantId,
      name: `Property ${label}`,
      country: 'TG',
      timezone: 'Africa/Lome',
      businessDate: new Date('2026-11-12'),
    },
  });
  const propertyId = property.id;
  const roomType = await admin.roomType.create({
    data: { tenantId, propertyId, code: 'DBL', name: 'Double', maxAdults: 2, baseOccupancy: 2 },
  });
  const room = await admin.room.create({
    data: { tenantId, propertyId, roomTypeId: roomType.id, number: '101' },
  });
  const ratePlan = await admin.ratePlan.create({
    data: { tenantId, propertyId, code: 'BAR', name: 'Best available' },
  });
  const guest = await admin.guest.create({
    data: { tenantId, firstName: 'Ama', lastName: `Guest-${label}` },
  });
  const reservation = await admin.reservation.create({
    data: {
      tenantId,
      propertyId,
      number: `R-${u}`,
      bookerGuestId: guest.id,
      arrival: new Date('2026-12-01'),
      departure: new Date('2026-12-03'),
    },
  });
  const reservationRoom = await admin.reservationRoom.create({
    data: {
      tenantId,
      propertyId,
      reservationId: reservation.id,
      roomTypeId: roomType.id,
      roomId: room.id,
      ratePlanId: ratePlan.id,
      arrival: reservation.arrival,
      departure: reservation.departure,
    },
  });
  const folio = await admin.folio.create({ data: { tenantId, propertyId, number: `F-${u}` } });
  const folioLine = await admin.folioLine.create({
    data: {
      tenantId,
      propertyId,
      folioId: folio.id,
      businessDate: new Date('2026-12-01'),
      type: 'ROOM',
      label: 'Nuitée',
      unitAmount: 25_000n,
      amount: 25_000n,
    },
  });
  return {
    tenant,
    tenantId,
    property,
    propertyId,
    roomType,
    room,
    ratePlan,
    guest,
    reservation,
    reservationRoom,
    folio,
    folioLine,
  };
}

export type TenantFixture = Awaited<ReturnType<typeof createTenantFixture>>;

export async function createSpaFixture(admin: AdminClient, t: TenantFixture) {
  const { tenantId, propertyId } = t;
  const employee = await admin.employee.create({
    data: { tenantId, firstName: 'Kossi', lastName: 'Therapist' },
  });
  const therapist = await admin.therapist.create({
    data: { tenantId, employeeId: employee.id, skills: ['MASSAGE'] },
  });
  const treatmentRoom = await admin.treatmentRoom.create({
    data: { tenantId, propertyId, name: 'Cabine 1' },
  });
  const spaService = await admin.spaService.create({
    data: { tenantId, propertyId, nameI18n: { fr: 'Massage' }, durationMin: 60, price: 30_000n },
  });
  return { employee, therapist, treatmentRoom, spaService };
}
