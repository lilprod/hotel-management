import { z } from 'zod';
import type { Config } from '../../config.js';
import { defineSetting } from '../../core/settings.js';
import type { Logger } from '../logger.js';
import { NoneFiscalInvoiceProvider } from './fiscal-none.js';
import { ConsoleNotificationProvider, SmtpNotificationProvider } from './notification.js';
import { ManualPaymentProvider } from './payment-manual.js';
import { GotenbergPdfRenderer } from './pdf-gotenberg.js';
import type {
  FiscalInvoiceProvider,
  NotificationChannel,
  NotificationProvider,
  PaymentProvider,
  PdfRenderer,
} from './types.js';

export * from './types.js';
export { ManualPaymentProvider, SmtpNotificationProvider, ConsoleNotificationProvider };
export { GotenbergPdfRenderer, NoneFiscalInvoiceProvider };

/** Tenant-level adapter selection (settings hierarchy). */
export const providerSettings = {
  payment: defineSetting({
    key: 'providers.payment',
    schema: z.string().min(1),
    default: 'manual',
  }),
  fiscal: defineSetting({ key: 'providers.fiscal', schema: z.string().min(1), default: 'none' }),
  sms: defineSetting({ key: 'providers.sms', schema: z.string().min(1), default: 'sms-console' }),
} as const;

/** Registry of the available adapter implementations, looked up by name. */
export class ProviderRegistry {
  private readonly payments = new Map<string, PaymentProvider>();
  private readonly notifications = new Map<string, NotificationProvider>();
  private readonly fiscal = new Map<string, FiscalInvoiceProvider>();

  constructor(readonly pdf: PdfRenderer) {}

  addPayment(p: PaymentProvider): this {
    this.payments.set(p.name, p);
    return this;
  }
  addNotification(p: NotificationProvider): this {
    this.notifications.set(p.name, p);
    return this;
  }
  addFiscal(p: FiscalInvoiceProvider): this {
    this.fiscal.set(p.name, p);
    return this;
  }

  payment(name: string): PaymentProvider {
    return required(this.payments.get(name), 'payment', name);
  }
  notification(name: string): NotificationProvider {
    return required(this.notifications.get(name), 'notification', name);
  }
  notificationFor(channel: NotificationChannel): NotificationProvider[] {
    return [...this.notifications.values()].filter((n) => n.channel === channel);
  }
  fiscalProvider(name: string): FiscalInvoiceProvider {
    return required(this.fiscal.get(name), 'fiscal', name);
  }
}

function required<T>(v: T | undefined, kind: string, name: string): T {
  if (!v) throw new Error(`Unknown ${kind} provider ${name}`);
  return v;
}

/** v1 implementations. SMTP is registered only when SMTP_URL is configured. */
export function createProviders(config: Config, logger: Logger): ProviderRegistry {
  const reg = new ProviderRegistry(new GotenbergPdfRenderer(config.GOTENBERG_URL))
    .addPayment(new ManualPaymentProvider())
    .addFiscal(new NoneFiscalInvoiceProvider())
    .addNotification(new ConsoleNotificationProvider('sms', logger))
    .addNotification(new ConsoleNotificationProvider('whatsapp', logger));
  if (config.SMTP_URL)
    reg.addNotification(new SmtpNotificationProvider(config.SMTP_URL, config.MAIL_FROM));
  return reg;
}
