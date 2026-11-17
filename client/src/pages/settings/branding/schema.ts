import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalidColor');
const opt = (max: number) => z.string().trim().max(max);

export const brandingFormSchema = z.object({
  primaryColor: hex,
  secondaryColor: hex,
  docHeader: opt(2000),
  docFooter: opt(2000),
  legalMentions: opt(4000),
  emailSenderName: opt(100).regex(/^[^\r\n<>@"]*$/, 'invalidSender'),
  loginMessage: opt(1000),
  legal: z.object({
    legalForm: opt(100),
    nif: opt(50),
    rccm: opt(50),
    taxRegime: opt(100),
    address: opt(300),
  }),
});
export type BrandingForm = z.infer<typeof brandingFormSchema>;

const nullIfEmpty = (v: string) => (v === '' ? null : v);

/** Form values (empty strings) to the PUT payload (null clears a field). */
export function toPayload(v: BrandingForm) {
  return {
    primaryColor: v.primaryColor,
    secondaryColor: v.secondaryColor,
    docHeader: nullIfEmpty(v.docHeader),
    docFooter: nullIfEmpty(v.docFooter),
    legalMentions: nullIfEmpty(v.legalMentions),
    emailSenderName: nullIfEmpty(v.emailSenderName),
    loginMessage: nullIfEmpty(v.loginMessage),
    legal: {
      legalForm: nullIfEmpty(v.legal.legalForm),
      nif: nullIfEmpty(v.legal.nif),
      rccm: nullIfEmpty(v.legal.rccm),
      taxRegime: nullIfEmpty(v.legal.taxRegime),
      address: nullIfEmpty(v.legal.address),
    },
  };
}
