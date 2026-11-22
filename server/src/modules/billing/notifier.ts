import type { Services } from '../../core/container.js';
import { QueueFactory } from '../../jobs/queue.js';
import { notify, type NotifyChannel } from '../notifications/service.js';

/** A platform → tenant billing message (owner of the tenant account). */
export interface BillingNotice {
  tenantId: string;
  templateCode:
    | 'trial_ending'
    | 'invoice_upcoming'
    | 'invoice_due'
    | 'invoice_overdue'
    | 'account_suspended'
    | 'payment_receipt_platform'
    | 'payment_declaration_rejected';
  /** Template variables; `owner`, `hotel` and `billing.url` are filled in. */
  data: Record<string, unknown>;
  idempotencyKey: string;
  sms?: boolean;
}

export type BillingNotifier = (services: Services, notice: BillingNotice) => Promise<void>;

const queues = new WeakMap<Services, QueueFactory>();

async function ownerOf(services: Services, tenantId: string) {
  const tenant = await services.admin.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      email: true,
      phone: true,
      defaultLocale: true,
      tenantDomains: { where: { type: 'SUBDOMAIN' }, select: { hostname: true }, take: 1 },
    },
  });
  if (!tenant) return null;
  const owner = await services.admin.user.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      status: 'ACTIVE',
      userRoles: { some: { role: { rolePermissions: { some: { permissionKey: '*' } } } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, email: true, phone: true },
  });
  const host = tenant.tenantDomains[0]?.hostname;
  return {
    tenant,
    owner,
    email: tenant.email ?? owner?.email ?? undefined,
    phone: tenant.phone ?? owner?.phone ?? undefined,
    billingUrl: host ? `https://${host}/settings/subscription` : '',
  };
}

/** Default: `notify()` pipeline (mandatory billing templates, e-mail + optional SMS). */
const defaultNotifier: BillingNotifier = async (services, notice) => {
  const who = await ownerOf(services, notice.tenantId);
  if (!who || (!who.email && !who.phone)) return;
  let q = queues.get(services);
  if (!q) {
    q = new QueueFactory(services.config.REDIS_URL);
    queues.set(services, q);
  }
  const channels: NotifyChannel[] = notice.sms ? ['email', 'sms'] : ['email'];
  await notify(services, q, {
    tenantId: notice.tenantId,
    channels,
    to: {
      ...(who.email ? { email: who.email } : {}),
      ...(who.phone && /^\+?[0-9][0-9 ()-]{5,19}$/.test(who.phone) ? { phone: who.phone } : {}),
    },
    templateCode: notice.templateCode,
    locale: who.tenant.defaultLocale,
    userId: who.owner?.id,
    data: {
      owner: { name: who.owner?.name ?? who.tenant.name },
      hotel: { name: who.tenant.name },
      billing: { url: who.billingUrl },
      ...notice.data,
    },
    idempotencyKey: notice.idempotencyKey,
  });
};

let override: BillingNotifier | null = null;

/** Test hook: captures billing notices (`null` restores `notify()`). */
export function overrideBillingNotifier(fn: BillingNotifier | null): void {
  override = fn;
}

/** Sends a billing notice; delivery failures are logged, never thrown (the job retries). */
export async function sendBillingNotice(services: Services, notice: BillingNotice): Promise<void> {
  try {
    await (override ?? defaultNotifier)(services, notice);
  } catch (err) {
    services.logger.error('billing notice failed', {
      err: (err as Error).message,
      templateCode: notice.templateCode,
      tenantId: notice.tenantId,
    });
  }
}
