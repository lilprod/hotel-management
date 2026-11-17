import type { JobsOptions } from 'bullmq';
import { getTenantId, runWithTenant, type CommunicationChannel } from '@hm/database';
import {
  defaultTemplate,
  localeChain,
  renderMessage,
  type Locale,
  type MessageChannel,
  type TemplateOverride,
} from '@hm/templates';
import { z } from 'zod';
import type { Services } from '../../core/container.js';
import { AppError } from '../../lib/errors.js';
import { enqueueForTenant, type QueueFactory } from '../../jobs/index.js';
import { loadTenantMessaging } from './branding-loader.js';
import { deliverJob, type DeliverData } from './jobs.js';

export const NOTIFY_CHANNELS = ['email', 'sms', 'whatsapp', 'in_app'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

const recipientSchema = z.object({
  email: z
    .string()
    .max(254)
    .regex(/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/, 'Invalid e-mail')
    .optional(),
  /** E.164-like number; used for SMS and, unless `whatsapp` is set, WhatsApp. */
  phone: z
    .string()
    .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, 'Invalid phone number')
    .optional(),
  whatsapp: z
    .string()
    .regex(/^\+?[0-9][0-9 ()-]{5,19}$/)
    .optional(),
});
export type Recipient = z.infer<typeof recipientSchema>;

export interface NotifyInput {
  /** Must match the tenant of the current context when there is one. */
  tenantId: string;
  channels: readonly NotifyChannel[];
  to: Recipient;
  templateCode: string;
  locale?: string | undefined;
  /** Template variables (nested object; only whitelisted paths are used). */
  data: Record<string, unknown>;
  /** Staff user recipient: in-app notification and notification preferences. */
  userId?: string | undefined;
  /** Guest recipient: external messages are logged in `communications`. */
  guestId?: string | undefined;
  /** Relative app link stored on the in-app notification. */
  link?: string | undefined;
  /** Same key + code + channel = sent once (7 days). */
  idempotencyKey: string;
}

export type NotifyStatus =
  | 'queued'
  | 'delivered_in_app'
  | 'duplicate'
  | 'skipped_preference'
  | 'skipped_no_recipient'
  | 'skipped_no_user';

export interface NotifyResult {
  channel: NotifyChannel;
  status: NotifyStatus;
  jobId?: string;
}

const IDEMPOTENCY_TTL_S = 7 * 24 * 3600;
const DB_CHANNEL: Record<Exclude<NotifyChannel, 'in_app'>, MessageChannel> = {
  email: 'EMAIL',
  sms: 'SMS',
  whatsapp: 'WHATSAPP',
};

export interface Notifier {
  notify(input: NotifyInput): Promise<NotifyResult[]>;
}

export function createNotifier(
  services: Services,
  queues: QueueFactory,
  jobOptions: JobsOptions = {},
): Notifier {
  return { notify: (input) => notify(services, queues, input, jobOptions) };
}

/**
 * Single entry point of the pipeline (doc 03 §5): tenant override else default template,
 * render, enqueue on `notifications` (retries + backoff), in-app row + Socket.io for users.
 * Mandatory templates (security, billing) ignore the user's preferences.
 */
export async function notify(
  services: Services,
  queues: QueueFactory,
  input: NotifyInput,
  jobOptions: JobsOptions = {},
): Promise<NotifyResult[]> {
  const ctx = getTenantId();
  if (ctx && ctx !== input.tenantId)
    throw new AppError('FORBIDDEN', 'notify() tenant differs from the current context');
  if (!input.idempotencyKey) throw new AppError('BAD_REQUEST', 'idempotencyKey is required');
  const to = recipientSchema.safeParse(input.to);
  if (!to.success) throw new AppError('VALIDATION_ERROR', 'Invalid recipient');
  const def = defaultTemplate(input.templateCode);
  if (!def) throw new AppError('VALIDATION_ERROR', `Unknown template ${input.templateCode}`);

  const run = () => dispatch(services, queues, input, to.data, jobOptions);
  return ctx ? run() : runWithTenant(input.tenantId, run);
}

async function dispatch(
  services: Services,
  queues: QueueFactory,
  input: NotifyInput,
  to: Recipient,
  jobOptions: JobsOptions,
): Promise<NotifyResult[]> {
  const { tenantId } = input;
  const def = defaultTemplate(input.templateCode)!;
  const tm = await loadTenantMessaging(services, tenantId);
  const chain: Locale[] = localeChain(input.locale, tm.defaultLocale);
  const overrides = await services.db.messageTemplate.findMany({
    where: { tenantId, code: input.templateCode, locale: { in: chain } },
  });
  const findOverride =
    (channel: MessageChannel) =>
    (locale: Locale): TemplateOverride | undefined => {
      const row = overrides.find((o) => o.channel === channel && o.locale === locale);
      return row ? { subject: row.subject, body: row.body } : undefined;
    };
  const render = (channel: MessageChannel) =>
    renderMessage({
      code: input.templateCode,
      channel,
      locale: input.locale,
      tenantDefaultLocale: tm.defaultLocale,
      data: input.data,
      branding: tm.branding,
      findOverride: findOverride(channel),
    });

  const prefs = input.userId
    ? await services.db.notificationPreference.findUnique({
        where: { userId_type: { userId: input.userId, type: input.templateCode } },
      })
    : null;

  const results: NotifyResult[] = [];
  for (const channel of new Set(input.channels)) {
    const result = async (): Promise<NotifyResult> => {
      if (!def.mandatory && prefs && !prefs.channels.includes(channel))
        return { channel, status: 'skipped_preference' };

      const recipient =
        channel === 'email' ? to.email : channel === 'sms' ? to.phone : (to.whatsapp ?? to.phone);
      if (channel === 'in_app') {
        if (!input.userId) return { channel, status: 'skipped_no_user' };
      } else if (!recipient) return { channel, status: 'skipped_no_recipient' };

      const claim = `notify:${tenantId}:${input.idempotencyKey}:${input.templateCode}:${channel}`;
      const first = await services.redis.set(claim, '1', 'EX', IDEMPOTENCY_TTL_S, 'NX');
      if (first !== 'OK') return { channel, status: 'duplicate' };

      try {
        if (channel === 'in_app') {
          const [title, body] = await Promise.all([render('EMAIL'), render('SMS')]);
          const row = await services.db.notification.create({
            data: {
              tenantId,
              userId: input.userId!,
              type: input.templateCode,
              title: (title.subject ?? def.code).slice(0, 200),
              body: body.text.slice(0, 1000),
              link: input.link && input.link.startsWith('/') ? input.link : null,
            },
          });
          services.realtime?.emitToUser(tenantId, input.userId!, 'notification.created', {
            id: row.id,
            type: row.type,
            title: row.title,
            body: row.body,
            link: row.link,
            createdAt: row.createdAt.toISOString(),
          });
          return { channel, status: 'delivered_in_app' };
        }
        const msg = await render(DB_CHANNEL[channel]);
        const data: DeliverData = {
          tenantId,
          channel,
          to: recipient!,
          text: msg.text,
          locale: msg.locale,
          templateCode: input.templateCode,
          ...(msg.subject ? { subject: msg.subject } : {}),
          ...(msg.html ? { html: msg.html } : {}),
          ...(input.guestId ? { guestId: input.guestId } : {}),
          ...(input.userId ? { userId: input.userId } : {}),
          ...(channel === 'email' ? { senderName: tm.senderName } : {}),
          ...(channel === 'email' && tm.replyTo ? { replyTo: tm.replyTo } : {}),
        };
        const job = await enqueueForTenant(queues, deliverJob, data, {
          jobId: `${tenantId}__${input.idempotencyKey}__${input.templateCode}__${channel}`,
          ...jobOptions,
        });
        return { channel, status: 'queued', ...(job.id ? { jobId: job.id } : {}) };
      } catch (err) {
        await services.redis.del(claim); // let the caller retry the whole notify()
        throw err;
      }
    };
    results.push(await result());
  }
  return results;
}

export type { CommunicationChannel };
