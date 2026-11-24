import type { RCtx } from '../reservations/context.js';
import { sendGuestNotice } from '../reservations/context.js';
import { reservationSettings } from '../reservations/settings.js';

/**
 * Guest preference: `guest_preferences` key `notify.<template>` = `false` opts the guest out of
 * that (non-mandatory) message; key `notify.all` = `false` opts out of every message.
 */
async function optedOut(ctx: RCtx, guestId: string, template: string): Promise<boolean> {
  const prefs = await ctx.db.guestPreference.findMany({
    where: { guestId, key: { in: [`notify.${template}`, 'notify.all'] } },
    select: { value: true },
  });
  return prefs.some((p) => p.value === false);
}

export interface StayNotice {
  template: 'welcome' | 'post_stay';
  propertyId: string;
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  hotel: { name: string; phone: string | null };
  reservation: { roomNumber: string; checkOut: string };
  idempotencyKey: string;
  /** `post_stay` review link (optional). */
  reviewUrl?: string;
}

/** Best-effort guest message (never fails the desk operation). Returns true when queued. */
export async function sendStayNotice(ctx: RCtx, n: StayNotice): Promise<boolean> {
  const { guest } = n;
  if (!guest.email && !guest.phone) return false;
  try {
    if (await optedOut(ctx, guest.id, n.template)) return false;
    const channels = await ctx.services.settings.get(reservationSettings.reminderChannels as never, {
      tenantId: ctx.tenantId,
      propertyId: n.propertyId,
    });
    await sendGuestNotice(ctx.services, {
      tenantId: ctx.tenantId,
      channels: channels as ('email' | 'sms' | 'whatsapp')[],
      to: {
        ...(guest.email ? { email: guest.email } : {}),
        ...(guest.phone ? { phone: guest.phone } : {}),
      },
      templateCode: n.template,
      guestId: guest.id,
      data: {
        guest: { firstName: guest.firstName, lastName: guest.lastName },
        hotel: { name: n.hotel.name, phone: n.hotel.phone ?? '' },
        reservation: n.reservation,
        ...(n.reviewUrl ? { review: { url: n.reviewUrl } } : {}),
      },
      idempotencyKey: n.idempotencyKey,
    });
    return true;
  } catch (err) {
    ctx.services.logger.warn('stay notice not sent', { err, template: n.template });
    return false;
  }
}
