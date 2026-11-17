import { formatMoney, money } from '@hm/shared';
import Handlebars from 'handlebars';
import { safeHttpUrl } from './escape.js';
import type { Locale } from './locale.js';

export class TemplateError extends Error {
  override readonly name = 'TemplateError';
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/** Helpers a template may call; everything else is refused when a template is validated. */
export const ALLOWED_HELPERS = ['money', 'date', 'if', 'unless'] as const;
const BLOCK_HELPERS = new Set(['if', 'unless']);

type TemplateValue = string | number | boolean | null | undefined | TemplateValue[] | TemplateObject;
export interface TemplateObject {
  [key: string]: TemplateValue;
}

const hbs = Handlebars.create();

/** `{{money total}}` with total = { amount, currency } (integer minor units). */
hbs.registerHelper('money', (value: unknown) => {
  if (typeof value !== 'object' || value === null) return '';
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'number' || typeof currency !== 'string') return '';
  try {
    return formatMoney(money(amount, currency));
  } catch {
    return '';
  }
});

/** `{{date checkIn}}` with an ISO date (`YYYY-MM-DD`) or date-time, rendered in the template locale. */
hbs.registerHelper('date', (value: unknown, options: Handlebars.HelperOptions) => {
  if (typeof value !== 'string' || !value) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '';
  const locale = ((options.data as { locale?: Locale } | undefined)?.locale ?? 'fr') as Locale;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(d);
});

// --- Validation ---------------------------------------------------------------------------

type Node = hbs.AST.Node;

/**
 * Parses a template and returns the list of problems: unknown variables (outside the
 * whitelist), unknown helpers, raw `{{{ }}}` output, partials and decorators. Empty = safe.
 */
export function inspectTemplate(source: string, variables: readonly string[]): string[] {
  const allowed = new Set(variables);
  const issues: string[] = [];
  let ast: hbs.AST.Program;
  try {
    ast = hbs.parse(source);
  } catch (err) {
    return [`syntax error: ${(err as Error).message.split('\n')[0] ?? 'invalid template'}`];
  }

  const checkPath = (p: hbs.AST.Expression): void => {
    if (p.type === 'SubExpression') return checkCall(p as hbs.AST.SubExpression);
    if (p.type !== 'PathExpression') return; // literals
    const path = p as hbs.AST.PathExpression;
    if (path.data) issues.push(`data variable @${path.original.replace(/^@/, '')} is not allowed`);
    const root = path.parts[0];
    if (typeof root === 'string' && !allowed.has(root)) issues.push(`unknown variable "${root}"`);
  };

  const checkCall = (n: {
    path: hbs.AST.Expression;
    params: hbs.AST.Expression[];
    hash?: hbs.AST.Hash | undefined;
  }): void => {
    const name = (n.path as hbs.AST.PathExpression).original;
    if (!(ALLOWED_HELPERS as readonly string[]).includes(name))
      issues.push(`unknown helper "${name}"`);
    n.params.forEach(checkPath);
    n.hash?.pairs.forEach((pair) => checkPath(pair.value));
  };

  const walk = (node: Node | null | undefined): void => {
    if (!node) return;
    switch (node.type) {
      case 'Program':
        (node as hbs.AST.Program).body.forEach(walk);
        break;
      case 'MustacheStatement': {
        const m = node as hbs.AST.MustacheStatement;
        // `escaped` is false for `{{{x}}}` and `{{&x}}`.
        if (!m.escaped) issues.push('raw (unescaped) output {{{ }}} is not allowed');
        if (m.params.length > 0 || m.hash) checkCall(m);
        else checkPath(m.path);
        break;
      }
      case 'BlockStatement': {
        const b = node as hbs.AST.BlockStatement;
        const name = (b.path as hbs.AST.PathExpression).original;
        if (!BLOCK_HELPERS.has(name)) issues.push(`unknown block "${name}"`);
        b.params.forEach(checkPath);
        walk(b.program);
        walk(b.inverse);
        break;
      }
      case 'ContentStatement':
      case 'CommentStatement':
        break;
      default:
        issues.push(`${node.type} is not allowed`);
    }
  };

  walk(ast);
  return [...new Set(issues)];
}

/** Throws a TemplateError when the template is not safe for these variables. */
export function assertTemplate(source: string, variables: readonly string[]): void {
  const issues = inspectTemplate(source, variables);
  if (issues.length) throw new TemplateError(`Invalid template: ${issues.join('; ')}`, issues);
}

// --- Rendering ----------------------------------------------------------------------------

const cache = new Map<string, HandlebarsTemplateDelegate>();
const CACHE_MAX = 500;

function compile(source: string, escape: boolean): HandlebarsTemplateDelegate {
  const key = `${escape ? 'h' : 't'}:${source}`;
  let fn = cache.get(key);
  if (!fn) {
    if (cache.size >= CACHE_MAX) cache.clear();
    fn = hbs.compile(source, { noEscape: !escape, strict: false });
    cache.set(key, fn);
  }
  return fn;
}

/**
 * Keeps only whitelisted top-level keys; `*Url` values must be absolute http(s) URLs.
 * Anything else the caller passed is dropped before rendering.
 */
export function pickVariables(
  data: Record<string, unknown>,
  variables: readonly string[],
): TemplateObject {
  const out: TemplateObject = {};
  for (const key of variables) {
    const v = data[key];
    if (v === undefined || v === null) continue;
    if (/url$/i.test(key)) {
      const url = safeHttpUrl(v);
      if (url) out[key] = url;
      continue;
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'object') out[key] = JSON.parse(JSON.stringify(v)) as TemplateObject;
  }
  return out;
}

export interface RenderInput {
  source: string;
  data: Record<string, unknown>;
  variables: readonly string[];
  locale: Locale;
}

/** HTML/MJML fragment: every `{{x}}` is HTML-escaped. */
export function renderHtmlFragment(input: RenderInput): string {
  assertTemplate(input.source, input.variables);
  return compile(input.source, true)(pickVariables(input.data, input.variables), {
    data: { locale: input.locale },
  });
}

/** Plain text (subject, SMS, WhatsApp, text e-mail): no HTML escaping; CR/LF removed on request. */
export function renderPlain(input: RenderInput & { singleLine?: boolean }): string {
  assertTemplate(input.source, input.variables);
  const out = compile(input.source, false)(pickVariables(input.data, input.variables), {
    data: { locale: input.locale },
  });
  return input.singleLine ? out.replace(/[\r\n]+/g, ' ').trim() : out.trim();
}
