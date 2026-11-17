import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from '../logger.js';
import type {
  NotificationChannel,
  NotificationMessage,
  NotificationProvider,
  SendResult,
} from './types.js';

/** E-mail through SMTP (nodemailer). */
export class SmtpNotificationProvider implements NotificationProvider {
  readonly name = 'smtp';
  readonly channel = 'email' as const;
  private readonly transport: Transporter;

  constructor(
    smtpUrlOrTransport: string | Transporter,
    private readonly from: string,
  ) {
    this.transport =
      typeof smtpUrlOrTransport === 'string'
        ? nodemailer.createTransport(smtpUrlOrTransport)
        : smtpUrlOrTransport;
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    const info = (await this.transport.sendMail({
      from: withDisplayName(this.from, message.fromName),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      to: message.to,
      subject: message.subject ?? '',
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.attachments ? { attachments: message.attachments } : {}),
    })) as { messageId?: string; rejected?: unknown[] };
    return {
      channel: this.channel,
      provider: this.name,
      ...(info.messageId ? { messageId: info.messageId } : {}),
      accepted: !info.rejected?.length,
    };
  }
}

/**
 * Console stub for SMS / WhatsApp (v1, until a local aggregator adapter is chosen).
 * The recipient is masked by the logger redaction.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name: string;

  constructor(
    readonly channel: NotificationChannel,
    private readonly logger: Logger,
  ) {
    this.name = `${channel}-console`;
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    this.logger.info('notification (console stub)', {
      channel: this.channel,
      phone: message.to,
      length: message.text.length,
    });
    return { channel: this.channel, provider: this.name, accepted: true };
  }
}

/** `Name <addr@host>` from MAIL_FROM, with the tenant sender name replacing the display name. */
export function withDisplayName(from: string, name?: string): string {
  if (!name) return from;
  const addr = /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
  const safe = name.replace(/[\r\n"<>\\]/g, ' ').trim();
  return `"${safe}" <${addr}>`;
}
