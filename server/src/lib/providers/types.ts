/**
 * Adapter interfaces (doc 03 §5 bis X8). Implementations are selected per tenant through
 * settings (`providers.*`); v1 ships `manual`, `smtp`, console SMS/WhatsApp stubs, `gotenberg`,
 * `none` (fiscal).
 */

/** Integer minor units + ISO currency (never floats). */
export interface Money {
  amount: bigint;
  currency: string;
}

export interface PaymentIntentInput {
  tenantId: string;
  reference: string;
  money: Money;
  method: string;
  description?: string;
  metadata?: Record<string, string>;
}

export type PaymentIntentStatus = 'PENDING_VALIDATION' | 'CONFIRMED' | 'FAILED';

export interface PaymentIntent {
  provider: string;
  providerRef: string;
  status: PaymentIntentStatus;
  /** Redirect / instructions for the payer, if any. */
  instructions?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createIntent(input: PaymentIntentInput): Promise<PaymentIntent>;
  /** Parses a provider callback; `manual` has none. */
  handleWebhook?(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): Promise<PaymentIntent>;
}

export type NotificationChannel = 'email' | 'sms' | 'whatsapp';

export interface NotificationMessage {
  to: string;
  subject?: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export interface SendResult {
  channel: NotificationChannel;
  provider: string;
  messageId?: string;
  accepted: boolean;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<SendResult>;
}

export interface PdfRenderOptions {
  paper?: 'A4' | 'A5' | 'Letter';
  landscape?: boolean;
  marginsMm?: number;
}

export interface PdfRenderer {
  readonly name: string;
  renderHtml(html: string, opts?: PdfRenderOptions): Promise<Buffer>;
}

export interface FiscalDocumentInput {
  tenantId: string;
  documentType: 'INVOICE' | 'CREDIT_NOTE' | 'RECEIPT';
  number: string;
  issuedAt: Date;
  total: Money;
  payload: Record<string, unknown>;
}

export interface FiscalResult {
  provider: string;
  status: 'NOT_APPLICABLE' | 'ACCEPTED' | 'REJECTED' | 'PENDING';
  fiscalNumber?: string;
  qrCode?: string;
}

export interface FiscalInvoiceProvider {
  readonly name: string;
  submit(doc: FiscalDocumentInput): Promise<FiscalResult>;
}
