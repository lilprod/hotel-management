import { z } from 'zod';
import type { NotificationMessage, NotificationProvider, SendResult } from './types.js';

/** Per-tenant configuration of the generic HTTP SMS aggregator (setting `providers.sms_http`). */
export const smsHttpConfigSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), 'http(s) only'),
  /** Header carrying the token, e.g. `Authorization` or `X-Api-Key`. */
  tokenHeader: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,40}$/)
    .default('Authorization'),
  /** Full header value, e.g. `Bearer abc` (stored in settings, never logged). */
  token: z.string().min(1).max(500),
  /** Sender id / short code shown to the recipient. */
  sender: z.string().min(1).max(20),
});
export type SmsHttpConfig = z.infer<typeof smsHttpConfigSchema>;

/**
 * Generic JSON aggregator: `POST url {"to","from","message"}` with the token in a header.
 * Any 2xx is accepted; anything else throws so the queue retries with backoff.
 */
export class HttpSmsProvider implements NotificationProvider {
  readonly name = 'sms-http';
  readonly channel = 'sms' as const;

  constructor(
    private readonly config: SmsHttpConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async send(message: NotificationMessage): Promise<SendResult> {
    const res = await this.fetchImpl(this.config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [this.config.tokenHeader]: this.config.token },
      body: JSON.stringify({
        to: message.to,
        from: message.fromName ?? this.config.sender,
        message: message.text,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`SMS aggregator responded ${res.status}`);
    let messageId: string | undefined;
    try {
      const body = (await res.json()) as { id?: unknown; messageId?: unknown };
      const id = body.messageId ?? body.id;
      if (typeof id === 'string' || typeof id === 'number') messageId = String(id);
    } catch {
      /* body is optional */
    }
    return {
      channel: 'sms',
      provider: this.name,
      accepted: true,
      ...(messageId ? { messageId } : {}),
    };
  }
}
