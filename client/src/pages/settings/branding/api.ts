import { ApiError, api } from '../api';

export const ASSET_KINDS = [
  'logo',
  'logo-dark',
  'favicon',
  'login-background',
  'signature',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface AssetRef {
  url: string;
  size: number;
  mime: string;
}
export interface BrandingLegal {
  legalForm: string | null;
  nif: string | null;
  rccm: string | null;
  taxRegime: string | null;
  address: string | null;
}
export interface BrandingView {
  primaryColor: string | null;
  secondaryColor: string | null;
  docHeader: string | null;
  docFooter: string | null;
  legalMentions: string | null;
  emailSenderName: string | null;
  loginMessage: string | null;
  legal: BrandingLegal;
  assets: Partial<Record<AssetKind, AssetRef | null>>;
  contrast: {
    warnings: { code: string; message: string; ratio: number }[];
  };
  defaults: {
    primaryColor: string;
    secondaryColor: string;
    legalMentions: string;
    taxRegimes: string[];
  };
}
export interface TemplateView {
  id: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  code: string;
  locale: string;
  subject: string | null;
  body: string;
}
export interface TemplateCatalog {
  items: { code: string; channels: string[]; variables: { key: string; sample: string }[] }[];
}
export interface DomainView {
  subdomain: { hostname: string } | null;
  custom: {
    hostname: string;
    status: 'PENDING_VERIFICATION' | 'VERIFIED';
    verifiedAt: string | null;
    tlsStatus: string;
    txtRecord: { name: string; value: string };
  } | null;
  check?: { matched: boolean; found: string[] };
}

/** Multipart upload (field `file`); the browser sets the boundary, so no Content-Type here. */
export async function uploadAsset(kind: AssetKind, file: File) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/v1/t/branding/assets/${kind}`, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const p = data as {
      detail?: string;
      title?: string;
      errors?: { path: string; message: string }[];
    };
    throw new ApiError(res.status, p.errors?.[0]?.message ?? p.detail ?? p.title ?? res.statusText);
  }
  return data as { kind: AssetKind; asset: AssetRef; width: number; height: number };
}

export { api, ApiError };
