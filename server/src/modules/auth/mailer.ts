import type { Services } from '../../core/container.js';
import { QueueFactory } from '../../jobs/queue.js';
import { notify, type NotifyInput } from '../notifications/service.js';

export type AuthMessage = Pick<
  NotifyInput,
  'tenantId' | 'to' | 'templateCode' | 'locale' | 'data' | 'userId' | 'guestId' | 'idempotencyKey'
>;

/** Sends the security e-mails of the auth modules (reset links, invitations, verification). */
export type AuthMailer = (services: Services, message: AuthMessage) => Promise<void>;

const queues = new WeakMap<Services, QueueFactory>();

/** Default: the notification pipeline (`notify()`, e-mail channel, mandatory templates). */
const defaultMailer: AuthMailer = async (services, message) => {
  let q = queues.get(services);
  if (!q) {
    q = new QueueFactory(services.config.REDIS_URL);
    queues.set(services, q);
  }
  await notify(services, q, { ...message, channels: ['email'] });
};

let override: AuthMailer | null = null;

/** Test hook: captures auth messages instead of queueing them (`null` restores the default). */
export function overrideAuthMailer(mailer: AuthMailer | null): void {
  override = mailer;
}

export async function sendAuthMessage(services: Services, message: AuthMessage): Promise<void> {
  try {
    await (override ?? defaultMailer)(services, message);
  } catch (err) {
    // Never leak delivery failures (account enumeration); the pipeline retries on its own.
    services.logger.error('auth message delivery failed', {
      err,
      templateCode: message.templateCode,
    });
  }
}
