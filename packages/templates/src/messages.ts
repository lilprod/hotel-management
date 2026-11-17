import { normalizeBranding, type Branding } from './branding.js';
import { escapeHtml } from './escape.js';
import { DEFAULT_TEMPLATES, type DefaultTemplateDef } from './defaults.js';
import { renderHtmlFragment, renderPlain } from './engine.js';
import { renderEmailLayout } from './layout.js';
import { localeChain, type Locale } from './locale.js';
import { VARIABLE_SAMPLES } from './samples.js';

export type MessageChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

const BY_CODE = new Map(DEFAULT_TEMPLATES.map((t) => [t.code, t]));

export function defaultTemplate(code: string): DefaultTemplateDef | undefined {
  return BY_CODE.get(code);
}

export function templateChannels(def: DefaultTemplateDef): MessageChannel[] {
  return def.audience === 'guest' ? ['EMAIL', 'SMS', 'WHATSAPP'] : ['EMAIL', 'SMS'];
}

/** Closed catalog (code, channels, whitelisted variables with a sample) shared with the branding module. */
export function templateCatalog(): Record<
  string,
  { channels: readonly MessageChannel[]; variables: Record<string, string>; mandatory: boolean }
> {
  const out: Record<
    string,
    { channels: readonly MessageChannel[]; variables: Record<string, string>; mandatory: boolean }
  > = {};
  for (const t of DEFAULT_TEMPLATES)
    out[t.code] = {
      channels: templateChannels(t),
      mandatory: t.mandatory,
      variables: Object.fromEntries(t.variables.map((v) => [v, VARIABLE_SAMPLES[v] ?? ''])),
    };
  return out;
}

/** Tenant override (message_templates row) for one channel/locale. */
export interface TemplateOverride {
  subject?: string | null | undefined;
  body: string;
}

export interface RenderMessageInput {
  code: string;
  channel: MessageChannel;
  locale?: string | undefined;
  tenantDefaultLocale?: string | undefined;
  data: Record<string, unknown>;
  branding?: Partial<Branding> | undefined;
  /** Looks up a tenant override; first locale of the chain that has one wins. */
  findOverride?: (locale: Locale) => TemplateOverride | undefined;
}

export interface RenderedMessage {
  code: string;
  channel: MessageChannel;
  locale: Locale;
  source: 'override' | 'default';
  subject?: string;
  text: string;
  html?: string;
}

export class UnknownTemplateError extends Error {
  override readonly name = 'UnknownTemplateError';
}

/**
 * Tenant override first (locale chain: requested, tenant default, fr), else the default
 * template of the same chain. Every variable is HTML-escaped (HTML) or passed through
 * the plain renderer (subject/SMS/text) and limited to the code's whitelist.
 */
export async function renderMessage(input: RenderMessageInput): Promise<RenderedMessage> {
  const def = BY_CODE.get(input.code);
  if (!def) throw new UnknownTemplateError(`Unknown template code "${input.code}"`);
  if (!templateChannels(def).includes(input.channel))
    throw new UnknownTemplateError(`Template "${input.code}" is not available on ${input.channel}`);
  const chain = localeChain(input.locale, input.tenantDefaultLocale);
  const branding = input.branding ?? {};
  const base = { data: input.data, variables: def.variables };

  for (const locale of chain) {
    const o = input.findOverride?.(locale);
    if (!o) continue;
    const r = { ...base, locale, flattenMoney: true };
    const text = renderPlain({ ...r, source: o.body });
    const result: RenderedMessage = {
      code: def.code,
      channel: input.channel,
      locale,
      source: 'override',
      text,
    };
    if (input.channel === 'EMAIL') {
      const subject = renderPlain({
        ...r,
        source: o.subject || def.content[locale].subject,
        singleLine: true,
      });
      const paragraphs = o.body
        .split(/\n{2,}/)
        .map((p) => renderHtmlFragment({ ...r, source: p }).replace(/\n/g, '<br/>'));
      result.subject = subject;
      result.html = await renderEmailLayout({
        branding: normalizeBranding(branding),
        titleHtml: escapeHtml(subject),
        paragraphsHtml: paragraphs,
        lang: locale,
      });
    }
    return result;
  }

  const locale = chain[0] ?? 'fr';
  const c = def.content[locale];
  const r = { ...base, locale };
  if (input.channel !== 'EMAIL')
    return {
      code: def.code,
      channel: input.channel,
      locale,
      source: 'default',
      text: renderPlain({ ...r, source: c.sms }),
    };
  const subject = renderPlain({ ...r, source: c.subject, singleLine: true });
  const paragraphsText = c.paragraphs.map((p) => renderPlain({ ...r, source: p }));
  const ctaUrl = c.cta ? readUrl(input.data, c.cta.url) : undefined;
  const text = [
    renderPlain({ ...r, source: c.title }),
    ...paragraphsText,
    ...(c.cta && ctaUrl ? [`${c.cta.label}: ${ctaUrl}`] : []),
  ].join('\n\n');
  const html = await renderEmailLayout({
    branding: normalizeBranding(branding),
    titleHtml: renderHtmlFragment({ ...r, source: c.title }),
    paragraphsHtml: c.paragraphs.map((p) => renderHtmlFragment({ ...r, source: p })),
    cta: c.cta && ctaUrl ? { label: c.cta.label, url: ctaUrl } : undefined,
    lang: locale,
  });
  return { code: def.code, channel: 'EMAIL', locale, source: 'default', subject, text, html };
}

function readUrl(data: Record<string, unknown>, path: string): string | undefined {
  let v: unknown = data;
  for (const p of path.split('.')) v = (v as Record<string, unknown> | undefined)?.[p];
  return typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : undefined;
}
