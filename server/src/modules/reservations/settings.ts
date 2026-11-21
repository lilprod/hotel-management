import { z } from 'zod';
import { defineSetting } from '../../core/settings.js';

const tenantOrProperty = ['PLATFORM', 'TENANT', 'PROPERTY'] as const;

/** Reservation engine settings (hierarchy PROPERTY > TENANT > PLATFORM > default). */
export const reservationSettings = {
  overbookingAllowance: defineSetting({
    key: 'reservations.overbooking_allowance',
    schema: z.number().int().min(0).max(50),
    default: 0,
    scopes: tenantOrProperty,
    description: 'Extra units sellable per room type and night (0 = no overbooking)',
  }),
  optionHours: defineSetting({
    key: 'reservations.option_hours',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    default: 48,
    scopes: tenantOrProperty,
    description: 'Default validity of a PENDING (option) reservation, in hours',
  }),
  numberPattern: defineSetting({
    key: 'reservations.number_pattern',
    schema: z
      .string()
      .min(5)
      .max(40)
      .regex(/\{seq(:\d{1,2})?\}/, 'The pattern must contain {seq}'),
    default: 'RES-{YYYY}-{seq:6}',
    scopes: tenantOrProperty,
    description: 'Reservation number pattern ({YYYY}, {YY}, {seq:6})',
  }),
  reminderChannels: defineSetting({
    key: 'reservations.reminder_channels',
    schema: z.array(z.enum(['email', 'sms', 'whatsapp'])).max(3),
    default: ['email'] as ('email' | 'sms' | 'whatsapp')[],
    scopes: tenantOrProperty,
    description: 'Channels of the confirmation and J-3 / J-1 reminders',
  }),
  waitlistOfferHours: defineSetting({
    key: 'waitlist.offer_hours',
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 14),
    default: 24,
    scopes: tenantOrProperty,
    description: 'Time a waitlisted guest has to accept an offer, in hours',
  }),
};
