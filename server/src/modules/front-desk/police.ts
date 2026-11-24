import type { Prisma } from '@hm/database';
import type { PoliceFormData, PoliceRegisterData } from '@hm/templates';
import type { Response } from 'express';
import type { z } from 'zod';
import { notificationDeps } from '../notifications/deps.js';
import { renderPdf } from '../notifications/jobs.js';
import { sellerParty } from '../folio/parties.js';
import { asTx } from '../folio/repository.js';
import { formatDay, must, parseDay, toPage } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import { requireProperty } from '../reservations/service.js';
import { hasPerm, loadReservationRoom } from './common.js';
import { maskBirthDate, readIdNumber, type PoliceSnapshot } from './identity.js';
import type { PoliceRecordDto, policeExportQuery, policeListQuery } from './schemas.js';

const recordInclude = {
  guest: { select: { firstName: true, lastName: true } },
  stay: {
    select: {
      id: true,
      checkedInAt: true,
      propertyId: true,
      reservationRoomId: true,
    },
  },
} satisfies Prisma.PoliceRecordInclude;
type Row = Prisma.PoliceRecordGetPayload<{ include: typeof recordInclude }>;

/** Sensitive fields are shown only to holders of `guests.export` (doc 05 §5). */
const canSeeSensitive = (ctx: RCtx) => hasPerm(ctx, 'guests.export');

function toDto(ctx: RCtx, r: Row, unmasked: boolean): PoliceRecordDto {
  const s = r.snapshot as unknown as PoliceSnapshot;
  return {
    id: r.id,
    stayId: r.stayId,
    guestId: r.guestId,
    checkedInAt: r.stay.checkedInAt.toISOString(),
    firstName: s.firstName ?? r.guest.firstName,
    lastName: s.lastName ?? r.guest.lastName,
    birthDate: unmasked ? (s.birthDate ?? null) : maskBirthDate(s.birthDate ?? null),
    birthPlace: unmasked ? (s.birthPlace ?? null) : null,
    nationality: s.nationality ?? null,
    profession: s.profession ?? null,
    address: unmasked ? (s.address ?? null) : null,
    idDocType: s.idDocType ?? null,
    idDocNumber: readIdNumber(ctx, s.idDocNumberEnc ?? null, unmasked),
    idIssuedOn: s.idIssuedOn ?? null,
    idIssuedPlace: unmasked ? (s.idIssuedPlace ?? null) : null,
    provenance: s.provenance ?? null,
    destination: s.destination ?? null,
    purpose: s.purpose ?? null,
    arrival: s.arrival,
    departure: s.departure,
    roomNumber: s.roomNumber ?? null,
    reservationNumber: s.reservationNumber ?? null,
    hasSignature: !!r.signatureFileId,
    masked: !unmasked,
    customFields: s.customFields ?? {},
  };
}

function whereOf(
  q: Pick<z.infer<typeof policeListQuery>, 'propertyId' | 'from' | 'to' | 'search'>,
): Prisma.PoliceRecordWhereInput {
  const to = new Date(parseDay(q.to).getTime() + 86_400_000);
  return {
    stay: { propertyId: q.propertyId, checkedInAt: { gte: parseDay(q.from), lt: to } },
    ...(q.search
      ? {
          guest: {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };
}

/** Police register of a period (OP-25); every access is audited. */
export async function listPolice(ctx: RCtx, q: z.infer<typeof policeListQuery>) {
  await requireProperty(ctx, q.propertyId);
  const unmasked = canSeeSensitive(ctx);
  const rows = await ctx.db.policeRecord.findMany({
    where: whereOf(q),
    include: recordInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const page = toPage(rows, q.limit);
  await ctx.audit({
    action: 'front_desk.police_register.read',
    entity: 'police_register',
    entityId: q.propertyId,
    after: { from: q.from, to: q.to, count: page.items.length, unmasked },
  });
  return { items: page.items.map((r) => toDto(ctx, r, unmasked)), nextCursor: page.nextCursor, masked: !unmasked };
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS: [keyof PoliceRecordDto, string][] = [
  ['lastName', 'Nom'],
  ['firstName', 'Prénoms'],
  ['birthDate', 'Date de naissance'],
  ['birthPlace', 'Lieu de naissance'],
  ['nationality', 'Nationalité'],
  ['profession', 'Profession'],
  ['address', 'Domicile'],
  ['idDocType', 'Type de pièce'],
  ['idDocNumber', 'N° de pièce'],
  ['idIssuedOn', 'Délivrée le'],
  ['idIssuedPlace', 'Délivrée à'],
  ['provenance', 'Provenance'],
  ['destination', 'Destination'],
  ['purpose', 'Motif'],
  ['arrival', 'Arrivée'],
  ['departure', 'Départ prévu'],
  ['roomNumber', 'Chambre'],
  ['reservationNumber', 'Réservation'],
];

const MAX_EXPORT = 5000;

/** CSV (UTF-8 with BOM) or PDF register of a period. Same masking rule as the list. */
export async function exportPolice(
  ctx: RCtx,
  res: Response,
  q: z.infer<typeof policeExportQuery>,
): Promise<void> {
  const prop = await requireProperty(ctx, q.propertyId);
  const unmasked = canSeeSensitive(ctx);
  const rows = await ctx.db.policeRecord.findMany({
    where: whereOf(q),
    include: recordInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_EXPORT,
  });
  const dtos = rows.map((r) => toDto(ctx, r, unmasked));
  await ctx.audit({
    action: 'front_desk.police_register.export',
    entity: 'police_register',
    entityId: q.propertyId,
    after: { from: q.from, to: q.to, format: q.format, count: dtos.length, unmasked },
  });
  if (q.format === 'csv') {
    const lines = [CSV_COLUMNS.map(([, h]) => h).join(',')];
    for (const d of dtos) lines.push(CSV_COLUMNS.map(([k]) => csvCell(d[k])).join(','));
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="registre-${q.from}_${q.to}.csv"`);
    res.send(`${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`);
    return;
  }
  const data: PoliceRegisterData = {
    hotel: await sellerParty(ctx.services, asTx(ctx.db), ctx.tenantId, prop.id),
    period: { from: q.from, to: q.to },
    masked: !unmasked,
    rows: dtos.map((d) => ({
      name: `${d.lastName.toUpperCase()} ${d.firstName}`,
      ...(d.birthDate ? { birth: d.birthDate } : {}),
      ...(d.nationality ? { nationality: d.nationality } : {}),
      ...(d.profession ? { profession: d.profession } : {}),
      ...(d.address ? { address: d.address } : {}),
      idDoc: [d.idDocType, d.idDocNumber].filter(Boolean).join(' '),
      arrival: d.arrival,
      departure: d.departure,
      ...(d.roomNumber ? { room: d.roomNumber } : {}),
      ...(d.provenance ? { provenance: d.provenance } : {}),
      ...(d.destination ? { destination: d.destination } : {}),
    })),
  };
  const pdf = await renderPdf(ctx.services, {
    type: 'police_register',
    data,
    fileName: `registre-${q.from}_${q.to}.pdf`,
    ...(ctx.actorId ? { createdBy: ctx.actorId } : {}),
  });
  res.status(200).json({
    fileId: pdf.fileId,
    url: await notificationDeps(ctx.services).storage.signedUrl(pdf.key),
    count: dtos.length,
  });
}

/**
 * Printable police form of a stay (all its guests as companions of the primary one) rendered
 * with the `police_form` template (route guarded by `front_desk.police_form`, access audited).
 */
export async function policeFormPdf(ctx: RCtx, stayRef: string) {
  const stay = must(
    await ctx.db.stay.findFirst({
      where: { OR: [{ id: stayRef }, { reservationRoomId: stayRef }] },
    }),
    'Stay',
  );
  const rr = await loadReservationRoom(ctx, stay.reservationRoomId);
  const records = await ctx.db.policeRecord.findMany({
    where: { stayId: stay.id },
    include: recordInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // The printable form is the legal record itself: full data for `front_desk.police_form` holders.
  const unmasked = true;
  const dtos = records.map((r) => toDto(ctx, r, unmasked));
  const main = must(dtos[0], 'Police record');
  const prop = await requireProperty(ctx, rr.propertyId);
  const data: PoliceFormData = {
    hotel: await sellerParty(ctx.services, asTx(ctx.db), ctx.tenantId, prop.id),
    guest: {
      lastName: main.lastName,
      firstName: main.firstName,
      ...(main.birthDate ? { birthDate: main.birthDate } : {}),
      ...(main.birthPlace ? { birthPlace: main.birthPlace } : {}),
      ...(main.nationality ? { nationality: main.nationality } : {}),
      ...(main.profession ? { profession: main.profession } : {}),
      ...(main.address ? { address: main.address } : {}),
      ...(main.idDocType ? { idType: main.idDocType } : {}),
      ...(main.idDocNumber ? { idNumber: main.idDocNumber } : {}),
      ...(main.idIssuedPlace ? { idIssuedBy: main.idIssuedPlace } : {}),
      ...(main.idIssuedOn ? { idIssuedOn: main.idIssuedOn } : {}),
    },
    stay: {
      checkIn: main.arrival,
      checkOut: formatDay(rr.departure),
      ...(rr.room ? { room: rr.room.number } : {}),
      reservation: rr.reservation.number,
      ...(main.provenance ? { provenance: main.provenance } : {}),
      ...(main.destination ? { destination: main.destination } : {}),
      ...(main.purpose ? { purpose: main.purpose } : {}),
    },
    companions: dtos.slice(1).map((d) => ({
      lastName: d.lastName,
      firstName: d.firstName,
      ...(d.birthDate ? { birthDate: d.birthDate } : {}),
    })),
  };
  const pdf = await renderPdf(ctx.services, {
    type: 'police_form',
    data,
    fileName: `fiche-police-${rr.reservation.number}.pdf`,
    ...(ctx.actorId ? { createdBy: ctx.actorId } : {}),
  });
  await ctx.audit({
    action: 'front_desk.police_form.print',
    entity: 'stay',
    entityId: stay.id,
    after: { fileId: pdf.fileId, unmasked },
  });
  return {
    fileId: pdf.fileId,
    url: await notificationDeps(ctx.services).storage.signedUrl(pdf.key),
  };
}
