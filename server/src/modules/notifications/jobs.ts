import { randomUUID } from 'node:crypto';
import { requireTenantId } from '@hm/database';
import {
  renderDocumentHtml,
  DOCUMENT_PAPER,
  normalizeBranding,
  type DocumentData,
  type DocumentType,
  type Branding,
} from '@hm/templates';
import { defineJob, QUEUES, type QueueFactory, enqueueForTenant } from '../../jobs/index.js';
import type { Services } from '../../core/container.js';
import { HttpSmsProvider } from '../../lib/providers/index.js';
import type { NotificationProvider } from '../../lib/providers/index.js';
import { loadTenantMessaging } from './branding-loader.js';
import { notificationDeps } from './deps.js';
import { notificationSettings } from './settings.js';
import { providerSettings } from '../../lib/providers/index.js';

export interface DeliverData {
  tenantId: string;
  channel: 'email' | 'sms' | 'whatsapp';
  to: string;
  subject?: string;
  text: string;
  html?: string;
  locale: string;
  templateCode: string;
  guestId?: string;
  userId?: string;
  senderName?: string;
  replyTo?: string;
}

const DB_CHANNEL = { email: 'EMAIL', sms: 'SMS', whatsapp: 'WHATSAPP' } as const;

/** Adapter chosen by tenant settings (falls back to the console stub when unavailable). */
async function resolveProvider(
  services: Services,
  tenantId: string,
  channel: DeliverData['channel'],
): Promise<NotificationProvider> {
  const { providers, fetch: f } = notificationDeps(services);
  const at = { tenantId };
  const name =
    channel === 'email'
      ? await services.settings.get(notificationSettings.email, at)
      : channel === 'sms'
        ? await services.settings.get(providerSettings.sms, at)
        : await services.settings.get(notificationSettings.whatsapp, at);
  if (name === 'sms-http') {
    const cfg = await services.settings.get(notificationSettings.smsHttp, at);
    if (cfg) return new HttpSmsProvider(cfg, f);
    services.logger.warn('sms-http selected without configuration, console fallback', { tenantId });
    return providers.notification('sms-console');
  }
  if (providers.hasNotification(name)) return providers.notification(name);
  services.logger.warn('notification provider unavailable, console fallback', { name, channel });
  return providers.notification(`${channel}-console`);
}

/** Sends one rendered message; throws on provider failure so BullMQ retries with backoff. */
export const deliverJob = defineJob<DeliverData>({
  name: 'deliver',
  queue: QUEUES.notifications,
  handler: async (data, { services, tenantId }) => {
    const provider = await resolveProvider(services, data.tenantId, data.channel);
    const res = await provider.send({
      to: data.to,
      text: data.text,
      ...(data.subject ? { subject: data.subject } : {}),
      ...(data.html ? { html: data.html } : {}),
      ...(data.senderName ? { fromName: data.senderName } : {}),
      ...(data.replyTo ? { replyTo: data.replyTo } : {}),
    });
    if (!res.accepted) throw new Error(`${provider.name} rejected the message`);
    if (data.guestId) {
      try {
        await services.db.communication.create({
          data: {
            tenantId: tenantId!,
            guestId: data.guestId,
            channel: DB_CHANNEL[data.channel],
            direction: 'OUTBOUND',
            subject: data.subject ?? null,
            body: data.text,
            templateCode: data.templateCode,
            sentAt: new Date(),
            userId: data.userId ?? null,
          },
        });
      } catch (err) {
        // The message is out: never resend because the log failed.
        services.logger.error('communication log failed', { err: (err as Error).message });
      }
    }
    return { provider: provider.name, messageId: res.messageId ?? null };
  },
});

// --- PDF ----------------------------------------------------------------------------------

export interface RenderPdfInput<T extends DocumentType = DocumentType> {
  type: T;
  data: DocumentData[T];
  locale?: string;
  /** Download name; defaults to `<type>.pdf`. */
  fileName?: string;
  /** Overrides the tenant branding (partial). */
  branding?: Partial<Branding>;
  createdBy?: string;
}

export interface RenderedPdf {
  fileId: string;
  key: string;
  size: number;
}

/**
 * `renderPdf(templateCode, data, branding)`: HTML template -> Gotenberg -> storage helper ->
 * `files` row. Runs inside the tenant context; returns the file id (sensitive, signed-URL read).
 */
export async function renderPdf<T extends DocumentType>(
  services: Services,
  input: RenderPdfInput<T>,
): Promise<RenderedPdf> {
  const tenantId = requireTenantId();
  const tm = await loadTenantMessaging(services, tenantId);
  const branding = normalizeBranding({ ...tm.branding, ...input.branding });
  const html = renderDocumentHtml(
    input.type,
    input.data,
    branding,
    input.locale ?? tm.defaultLocale,
  );
  const { providers, storage } = notificationDeps(services);
  const pdf = await providers.pdf.renderHtml(
    html,
    DOCUMENT_PAPER[input.type] === 'ticket80'
      ? { widthMm: 80, heightMm: 297, marginsMm: 3 }
      : { paper: 'A4', marginsMm: 0 },
  );
  const fileName = (input.fileName ?? `${input.type}.pdf`).replace(/[^\w.-]+/g, '_').slice(0, 120);
  const stored = await storage.put({
    key: `documents/${input.type}/${randomUUID()}.pdf`,
    body: pdf,
    contentType: 'application/pdf',
    fileName,
  });
  const row = await services.db.file.create({
    data: {
      tenantId,
      key: stored.key,
      originalName: fileName,
      mime: 'application/pdf',
      size: BigInt(stored.size),
      isSensitive: true,
      scanStatus: 'CLEAN',
      createdBy: input.createdBy ?? null,
    },
  });
  return { fileId: row.id, key: stored.key, size: stored.size };
}

export interface PdfJobData extends RenderPdfInput {
  tenantId: string;
  /** Caller-chosen id echoed in the `document.rendered` realtime event. */
  correlationId?: string;
}

export const pdfRenderJob = defineJob<PdfJobData>({
  name: 'render',
  queue: QUEUES.pdfRender,
  options: { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  handler: async (data, { services, tenantId }) => {
    const out = await renderPdf(services, data);
    if (data.createdBy)
      services.realtime?.emitToUser(tenantId!, data.createdBy, 'document.rendered', {
        fileId: out.fileId,
        type: data.type,
        correlationId: data.correlationId ?? null,
      });
    return out;
  },
});

/** Queues a PDF rendering (`pdf-render`), for the tenant of the current context. */
export function enqueuePdf<T extends DocumentType>(
  queues: QueueFactory,
  input: RenderPdfInput<T> & { correlationId?: string },
) {
  return enqueueForTenant(queues, pdfRenderJob as never, input as never);
}
