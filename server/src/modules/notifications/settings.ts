import { z } from 'zod';
import { defineSetting } from '../../core/settings.js';
import { smsHttpConfigSchema } from '../../lib/providers/sms-http.js';

/** Per-tenant adapter choice and aggregator configuration (settings hierarchy). */
export const notificationSettings = {
  email: defineSetting({
    key: 'providers.email',
    schema: z.string().min(1),
    default: 'smtp',
    scopes: ['PLATFORM', 'TENANT'],
    description: 'E-mail adapter (`smtp`; `email-console` logs only).',
  }),
  whatsapp: defineSetting({
    key: 'providers.whatsapp',
    schema: z.string().min(1),
    default: 'whatsapp-console',
    scopes: ['PLATFORM', 'TENANT'],
    description: 'WhatsApp adapter (console stub in v1).',
  }),
  smsHttp: defineSetting({
    key: 'notifications.sms_http',
    schema: smsHttpConfigSchema.nullable(),
    default: null,
    scopes: ['TENANT'],
    description: 'Generic HTTP SMS aggregator: URL, token header and value, sender id.',
  }),
} as const;
