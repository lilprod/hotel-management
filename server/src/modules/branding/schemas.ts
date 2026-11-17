import { z } from 'zod';
import { defineSetting } from '../../core/settings.js';
import { TEMPLATE_CHANNELS } from './template-engine.js';

export const ASSET_KINDS = [
  'logo',
  'logo-dark',
  'favicon',
  'login-background',
  'signature',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Assets served by the public portal endpoint (the signature / stamp stays staff only). */
export const PUBLIC_ASSET_KINDS = ['logo', 'logo-dark', 'favicon', 'login-background'] as const;
export type PublicAssetKind = (typeof PUBLIC_ASSET_KINDS)[number];

export const LOCALES = ['fr', 'en'] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB colour');
const optText = (max: number) => z.string().trim().max(max).nullable();

// ---------------------------------------------------------------------------------------------
// Settings (data the branding table has no column for: legal identifiers, public profile)
// ---------------------------------------------------------------------------------------------

export const legalSchema = z.object({
  legalForm: z.string().max(100).nullable(),
  nif: z.string().max(50).nullable(),
  rccm: z.string().max(50).nullable(),
  taxRegime: z.string().max(100).nullable(),
  address: z.string().max(300).nullable(),
});
export type LegalIdentity = z.infer<typeof legalSchema>;

export const publicProfileSchema = z.object({
  languages: z.array(z.enum(LOCALES)).min(1),
  contact: z.object({
    phone: z.string().max(40).nullable(),
    email: z.string().max(200).nullable(),
    address: z.string().max(300).nullable(),
    website: z.string().max(200).nullable(),
  }),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

export const brandingSettings = {
  legal: defineSetting({
    key: 'branding.legal',
    schema: legalSchema,
    default: { legalForm: null, nif: null, rccm: null, taxRegime: null, address: null },
    scopes: ['PLATFORM', 'TENANT'],
    description: 'Legal identifiers printed on financial documents (NIF, RCCM, tax regime).',
  }),
  profile: defineSetting({
    key: 'branding.public_profile',
    schema: publicProfileSchema,
    default: {
      languages: ['fr'],
      contact: { phone: null, email: null, address: null, website: null },
    },
    scopes: ['PLATFORM', 'TENANT'],
    description: 'Languages and contact details exposed by the public portal branding.',
  }),
} as const;

/** Suggested régimes fiscaux for Togo (doc 09 §3), editable free text. */
export const TOGO_TAX_REGIMES = ['RNI', 'RSI', 'TPU'] as const;

/** Default mention block for Togo invoices (doc 09 §3), used when the tenant has none. */
export const DEFAULT_LEGAL_MENTIONS_TG =
  'NIF : {{nif}} - RCCM : {{rccm}} - Régime fiscal : {{taxRegime}}';

// ---------------------------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------------------------

export const brandingUpdateSchema = z
  .object({
    primaryColor: hexColor.nullable(),
    secondaryColor: hexColor.nullable(),
    docHeader: optText(2000),
    docFooter: optText(2000),
    legalMentions: optText(4000),
    emailSenderName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\r\n<>@"]+$/, 'No line break, quote, angle bracket or @')
      .nullable(),
    loginMessage: optText(1000),
    legal: legalSchema.partial(),
    profile: z
      .object({
        languages: z.array(z.enum(LOCALES)).min(1),
        contact: publicProfileSchema.shape.contact.partial(),
      })
      .partial(),
  })
  .partial();
export type BrandingUpdate = z.infer<typeof brandingUpdateSchema>;

const assetRefSchema = z.object({ url: z.string(), size: z.number().int(), mime: z.string() });

const contrastSchema = z.object({
  primary: z
    .object({ vsWhite: z.number(), vsBlack: z.number(), onPrimary: z.enum(['#ffffff', '#000000']) })
    .nullable(),
  secondary: z.object({ vsWhite: z.number() }).nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), ratio: z.number() })),
});

export const brandingViewSchema = z.object({
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  docHeader: z.string().nullable(),
  docFooter: z.string().nullable(),
  legalMentions: z.string().nullable(),
  emailSenderName: z.string().nullable(),
  loginMessage: z.string().nullable(),
  legal: legalSchema,
  profile: publicProfileSchema,
  assets: z.record(z.enum(ASSET_KINDS), assetRefSchema.nullable()),
  contrast: contrastSchema,
  defaults: z.object({
    primaryColor: z.string(),
    secondaryColor: z.string(),
    legalMentions: z.string(),
    taxRegimes: z.array(z.string()),
  }),
  updatedAt: z.string().nullable(),
});
export type BrandingView = z.infer<typeof brandingViewSchema>;

export const assetParamsSchema = z.object({ kind: z.enum(ASSET_KINDS) });
export const publicAssetParamsSchema = z.object({ kind: z.enum(PUBLIC_ASSET_KINDS) });

export const assetUploadResponseSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  asset: assetRefSchema,
  width: z.number().int(),
  height: z.number().int(),
});

export const signedAssetSchema = z.object({ url: z.string(), expiresInSeconds: z.number() });

// ---------------------------------------------------------------------------------------------
// Public portal view
// ---------------------------------------------------------------------------------------------

export const publicBrandingSchema = z.object({
  name: z.string(),
  colors: z.object({ primary: z.string(), secondary: z.string(), onPrimary: z.string() }),
  logoUrl: z.string().nullable(),
  logoDarkUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  loginBackgroundUrl: z.string().nullable(),
  loginMessage: z.string().nullable(),
  languages: z.array(z.enum(LOCALES)),
  defaultLocale: z.string(),
  contact: publicProfileSchema.shape.contact,
});
export type PublicBranding = z.infer<typeof publicBrandingSchema>;

// ---------------------------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------------------------

const channelSchema = z.enum(TEMPLATE_CHANNELS);
const localeSchema = z.enum(LOCALES);
const codeSchema = z.string().min(1).max(80);

export const templateInputSchema = z.object({
  channel: channelSchema,
  code: codeSchema,
  locale: localeSchema,
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().min(1).max(10_000),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

export const templateUpdateSchema = z.object({
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().min(1).max(10_000),
});

export const templateListQuerySchema = z.object({
  channel: channelSchema.optional(),
  code: codeSchema.optional(),
  locale: localeSchema.optional(),
});

export const templateIdParamsSchema = z.object({ id: z.string().uuid() });

export const templateViewSchema = z.object({
  id: z.string().uuid(),
  channel: channelSchema,
  code: z.string(),
  locale: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  updatedAt: z.string(),
});
export type TemplateView = z.infer<typeof templateViewSchema>;

export const templatePreviewSchema = z.object({
  channel: channelSchema,
  code: codeSchema,
  subject: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(10_000),
  /** Overrides of sample values, keyed by whitelisted dotted variable. */
  data: z.record(z.string(), z.string().max(500)).optional(),
});
export type TemplatePreviewInput = z.infer<typeof templatePreviewSchema>;

export const templatePreviewResponseSchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  variablesUsed: z.array(z.string()),
});

export const templateCatalogResponseSchema = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      channels: z.array(channelSchema),
      variables: z.array(z.object({ key: z.string(), sample: z.string() })),
    }),
  ),
});

// ---------------------------------------------------------------------------------------------
// Custom domain
// ---------------------------------------------------------------------------------------------

export const domainInputSchema = z.object({ hostname: z.string().trim().min(4).max(253) });

export const domainViewSchema = z.object({
  subdomain: z.object({ hostname: z.string() }).nullable(),
  custom: z
    .object({
      hostname: z.string(),
      status: z.enum(['PENDING_VERIFICATION', 'VERIFIED']),
      verifiedAt: z.string().nullable(),
      tlsStatus: z.string(),
      txtRecord: z.object({ name: z.string(), value: z.string() }),
    })
    .nullable(),
  /** Only set by the verify endpoint. */
  check: z.object({ matched: z.boolean(), found: z.array(z.string()) }).optional(),
});
export type DomainView = z.infer<typeof domainViewSchema>;
