import type { PaymentIntent, PaymentIntentInput, PaymentProvider } from './types.js';

/**
 * Manual payments (v1): mobile money / cash / card recorded by staff or the Super Admin and
 * validated by a human. The intent stays PENDING_VALIDATION until confirmed by the billing flow.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntent> {
    return {
      provider: this.name,
      providerRef: input.reference,
      status: 'PENDING_VALIDATION',
      instructions: 'Payment to be validated manually',
    };
  }
}
