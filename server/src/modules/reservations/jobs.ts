import type { Services } from '../../core/container.js';
import { defineJob } from '../../jobs/context.js';
import { addDays, formatDay, localDay } from '../availability/dates.js';
import { matchWaitlist } from '../waitlist/service.js';
import { RESERVATIONS_QUEUE } from '../waitlist/jobs.js';
import { now, runSystem, sendGuestNotice } from './context.js';
import { releaseAllotment } from './groups.js';
import { splitCustomFields } from './repository.js';
import { expireOption, settingAt } from './service.js';
import { reservationSettings } from './settings.js';

export interface TickData {
  /** ISO instant (tests / manual replays); defaults to the clock. */
  now?: string;
}
const tickNow = (d: TickData | undefined) => (d?.now ? new Date(d.now) : now());

export interface ExpiryResult {
  expiredOptions: string[];
  releasedAllotments: string[];
  offered: string[];
  expiredOffers: string[];
}

/**
 * `pending-expiry` (cross-tenant scan with the admin client, writes in each tenant's RLS
 * context): expired options → CANCELLED (nights freed), group allotments past their release
 * date → released, then waitlist matching of every property with open entries (expired offers
 * move on to the next candidate; covers releases that emit no event, e.g. a lifted block).
 */
export async function runPendingExpiry(
  services: Services,
  at: Date = now(),
): Promise<ExpiryResult> {
  const out: ExpiryResult = {
    expiredOptions: [],
    releasedAllotments: [],
    offered: [],
    expiredOffers: [],
  };
  const due = await services.admin.reservation.findMany({
    where: { status: 'PENDING', pendingExpiresAt: { lte: at } },
    select: { id: true, tenantId: true },
    orderBy: { pendingExpiresAt: 'asc' },
    take: 500,
  });
  for (const r of due)
    try {
      if (await runSystem(services, r.tenantId, (ctx) => expireOption(ctx, r.id, at)))
        out.expiredOptions.push(r.id);
    } catch (err) {
      services.logger.error('option expiry failed', { err, reservationId: r.id });
    }

  const holders = await services.admin.reservation.findMany({
    where: {
      groupId: { not: null },
      bookerGuestId: null,
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: {
      id: true,
      tenantId: true,
      customFields: true,
      property: { select: { businessDate: true } },
    },
    take: 500,
  });
  for (const h of holders) {
    const release = splitCustomFields(h.customFields).sys.allotment?.releaseDate;
    if (!release || release > formatDay(h.property.businessDate)) continue;
    try {
      if (
        await runSystem(services, h.tenantId, (ctx) =>
          releaseAllotment(ctx, h.id, { all: true, cause: 'release_date' }),
        )
      )
        out.releasedAllotments.push(h.id);
    } catch (err) {
      services.logger.error('allotment release failed', { err, reservationId: h.id });
    }
  }

  const open = await services.admin.waitlistEntry.groupBy({
    by: ['tenantId', 'propertyId'],
    where: { status: { in: ['WAITING', 'OFFERED'] } },
  });
  for (const p of open)
    try {
      const r = await runSystem(services, p.tenantId, (ctx) =>
        matchWaitlist(ctx, p.propertyId, at),
      );
      out.offered.push(...r.offered);
      out.expiredOffers.push(...r.expired);
    } catch (err) {
      services.logger.error('waitlist match failed', { err, propertyId: p.propertyId });
    }
  return out;
}

export const pendingExpiryJob = defineJob<TickData>({
  name: 'pending-expiry',
  queue: RESERVATIONS_QUEUE,
  tenantScoped: false,
  repeat: { pattern: '*/5 * * * *' },
  options: { attempts: 3 },
  handler: (data, { services }) => runPendingExpiry(services, tickNow(data)),
});

// ───────────────────────────── reminders ─────────────────────────────

const REMINDERS = [
  { daysBefore: 3, template: 'pre_arrival' },
  { daysBefore: 1, template: 'booking_reminder' },
] as const;

export interface ReminderSent {
  reservationId: string;
  template: string;
}

/**
 * `booking-reminders` (OP-16): J-3 `pre_arrival` and J-1 `booking_reminder` to the booker of
 * every CONFIRMED reservation, J computed in the property time zone. Idempotent: one message per
 * (reservation, template, arrival), whatever the number of runs.
 */
export async function runBookingReminders(
  services: Services,
  at: Date = now(),
): Promise<ReminderSent[]> {
  const sent: ReminderSent[] = [];
  const properties = await services.admin.property.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      tenantId: true,
      timezone: true,
      name: true,
      phone: true,
      address: true,
      checkinTime: true,
    },
  });
  for (const p of properties) {
    const today = localDay(at, p.timezone);
    for (const rem of REMINDERS) {
      const arrival = addDays(today, rem.daysBefore);
      const rows = await services.admin.reservation.findMany({
        where: {
          propertyId: p.id,
          status: 'CONFIRMED',
          arrival: new Date(`${arrival}T00:00:00.000Z`),
          bookerGuestId: { not: null },
        },
        select: {
          id: true,
          number: true,
          bookerGuest: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
        },
      });
      for (const r of rows) {
        const g = r.bookerGuest;
        if (!g || (!g.email && !g.phone)) continue;
        const claim = `hm:resv-reminder:${p.tenantId}:${r.id}:${rem.template}:${arrival}`;
        if ((await services.redis.set(claim, '1', 'EX', 14 * 24 * 3600, 'NX')) !== 'OK') continue;
        try {
          await runSystem(services, p.tenantId, async (ctx) => {
            const channels = await settingAt(ctx, reservationSettings.reminderChannels, p.id);
            await sendGuestNotice(services, {
              tenantId: p.tenantId,
              channels,
              to: {
                ...(g.email ? { email: g.email } : {}),
                ...(g.phone ? { phone: g.phone } : {}),
              },
              templateCode: rem.template,
              guestId: g.id,
              data: {
                guest: { firstName: g.firstName, lastName: g.lastName },
                hotel: { name: p.name, phone: p.phone ?? '', address: p.address ?? '' },
                reservation: { number: r.number, checkIn: arrival, checkInTime: p.checkinTime },
              },
              idempotencyKey: `reservation:${r.id}:${rem.template}:${arrival}`,
            });
          });
          sent.push({ reservationId: r.id, template: rem.template });
        } catch (err) {
          await services.redis.del(claim);
          services.logger.error('booking reminder failed', { err, reservationId: r.id });
        }
      }
    }
  }
  return sent;
}

export const bookingRemindersJob = defineJob<TickData>({
  name: 'booking-reminders',
  queue: RESERVATIONS_QUEUE,
  tenantScoped: false,
  repeat: { pattern: '17 * * * *' },
  options: { attempts: 3 },
  handler: async (data, { services }) => ({
    sent: (await runBookingReminders(services, tickNow(data))).length,
  }),
});
