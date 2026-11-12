import type { FiscalDocumentInput, FiscalInvoiceProvider, FiscalResult } from './types.js';

/** No fiscal device / e-invoicing authority (v1 default; country adapters come later). */
export class NoneFiscalInvoiceProvider implements FiscalInvoiceProvider {
  readonly name = 'none';

  async submit(_doc: FiscalDocumentInput): Promise<FiscalResult> {
    return { provider: this.name, status: 'NOT_APPLICABLE' };
  }
}
