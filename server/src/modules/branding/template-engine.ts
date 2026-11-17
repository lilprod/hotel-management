import { templateCatalog } from '@hm/templates';
import Handlebars from 'handlebars';

/** Communication channels that can carry a template (PHONE / NOTE are not message channels). */
export const TEMPLATE_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export interface TemplateCatalogEntry {
  channels: readonly TemplateChannel[];
  /** Variable whitelist: dotted paths usable in `{{ }}`. */
  variables: Readonly<Record<string, string>>;
}

/**
 * Message codes and the variables each one may use (value = sample used by the preview).
 * Single source of truth: the default templates of @hm/templates (the notifications module
 * renders the same codes, so a tenant override can only use what the defaults can).
 */
export const TEMPLATE_CATALOG: Readonly<Record<string, TemplateCatalogEntry>> = Object.freeze(
  Object.fromEntries(
    Object.entries(templateCatalog()).map(([code, e]) => [
      code,
      { channels: e.channels as readonly TemplateChannel[], variables: e.variables },
    ]),
  ),
);

export function catalogEntry(code: string): TemplateCatalogEntry | undefined {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_CATALOG, code)
    ? TEMPLATE_CATALOG[code]
    : undefined;
}

export interface TemplateIssue {
  path: string;
  message: string;
  code: string;
}

type Node = hbs.AST.Statement;

const BLOCK_HELPERS = new Set(['if', 'unless']);

function checkPath(
  expr: hbs.AST.Expression,
  allowed: ReadonlySet<string>,
  where: string,
  issues: TemplateIssue[],
  used: Set<string>,
): void {
  if (expr.type !== 'PathExpression') {
    issues.push({
      path: where,
      message: 'Only plain variables are allowed',
      code: 'template_syntax',
    });
    return;
  }
  const p = expr as hbs.AST.PathExpression;
  if (!allowed.has(p.original)) {
    issues.push({
      path: where,
      message: `Variable "${p.original}" is not allowed for this template`,
      code: 'template_variable',
    });
    return;
  }
  used.add(p.original);
}

function walk(
  statements: readonly Node[],
  allowed: ReadonlySet<string>,
  where: string,
  issues: TemplateIssue[],
  used: Set<string>,
): void {
  for (const s of statements) {
    switch (s.type) {
      case 'ContentStatement':
      case 'CommentStatement':
        break;
      case 'MustacheStatement': {
        const m = s as hbs.AST.MustacheStatement;
        if (!m.escaped)
          issues.push({
            path: where,
            message: 'Unescaped output ({{{ }}}) is forbidden',
            code: 'template_syntax',
          });
        else if ((m.params?.length ?? 0) > 0 || m.hash)
          issues.push({ path: where, message: 'Helpers are not allowed', code: 'template_syntax' });
        else checkPath(m.path, allowed, where, issues, used);
        break;
      }
      case 'BlockStatement': {
        const b = s as hbs.AST.BlockStatement;
        const name =
          b.path.type === 'PathExpression' ? (b.path as hbs.AST.PathExpression).original : '';
        const [param] = b.params;
        if (!BLOCK_HELPERS.has(name) || b.params.length !== 1 || b.hash || !param) {
          issues.push({
            path: where,
            message: 'Only {{#if variable}} and {{#unless variable}} blocks are allowed',
            code: 'template_syntax',
          });
          break;
        }
        checkPath(param, allowed, where, issues, used);
        walk(b.program.body, allowed, where, issues, used);
        if (b.inverse) walk(b.inverse.body, allowed, where, issues, used);
        break;
      }
      default:
        issues.push({
          path: where,
          message: `${s.type.replace('Statement', '')} is not allowed in a message template`,
          code: 'template_syntax',
        });
    }
  }
}

/** Parses a template and returns its violations (syntax, non-whitelisted variables, helpers). */
export function validateTemplateText(
  text: string,
  where: string,
  allowed: ReadonlySet<string>,
  used: Set<string> = new Set(),
): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  let ast: hbs.AST.Program;
  try {
    ast = Handlebars.parse(text);
  } catch (err) {
    return [
      {
        path: where,
        message: `Template syntax error: ${(err as Error).message.split('\n')[0] ?? 'invalid'}`,
        code: 'template_syntax',
      },
    ];
  }
  walk(ast.body, allowed, where, issues, used);
  return issues;
}

/** Builds the nested rendering context from dotted keys. */
export function buildContext(flat: Readonly<Record<string, string>>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let cur = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) cur[part] = value;
      else cur = (cur[part] ??= {}) as Record<string, unknown>;
    });
  }
  return root;
}

const hbs_ = Handlebars.create();

/** Renders an already validated template; every `{{ }}` output is HTML-escaped. */
export function renderTemplate(text: string, context: Record<string, unknown>): string {
  return hbs_.compile(text, { noEscape: false, strict: false })(context);
}
