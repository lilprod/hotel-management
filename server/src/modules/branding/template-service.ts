import { requireTenantId, type AppClient, type CommunicationChannel } from '@hm/database';
import type { Request } from 'express';
import { AppError, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../middleware/audit.js';
import type {
  TemplateInput,
  TemplatePreviewInput,
  TemplateView,
} from './schemas.js';
import {
  buildContext,
  catalogEntry,
  renderTemplate,
  TEMPLATE_CATALOG,
  validateTemplateText,
  type TemplateIssue,
} from './template-engine.js';

function toView(t: {
  id: string;
  channel: CommunicationChannel;
  code: string;
  locale: string;
  subject: string | null;
  body: string;
  updatedAt: Date;
}): TemplateView {
  return {
    id: t.id,
    channel: t.channel as TemplateView['channel'],
    code: t.code,
    locale: t.locale,
    subject: t.subject,
    body: t.body,
    updatedAt: t.updatedAt.toISOString(),
  };
}

function fail(issues: TemplateIssue[]): never {
  throw new AppError('VALIDATION_ERROR', undefined, { errors: issues });
}

/**
 * Checks code / channel against the catalog and the template text against the variable
 * whitelist. Returns the variables used.
 */
export function checkTemplate(
  channel: string,
  code: string,
  subject: string | null | undefined,
  body: string,
): string[] {
  const entry = catalogEntry(code);
  if (!entry)
    return fail([{ path: 'code', message: `Unknown template code "${code}"`, code: 'template_code' }]);
  if (!entry.channels.includes(channel as never))
    return fail([
      { path: 'channel', message: `Code "${code}" is not available on ${channel}`, code: 'template_channel' },
    ]);
  if (subject && channel !== 'EMAIL')
    return fail([{ path: 'subject', message: 'Only e-mail templates have a subject', code: 'template_subject' }]);
  const allowed = new Set(Object.keys(entry.variables));
  const used = new Set<string>();
  const issues = [
    ...validateTemplateText(body, 'body', allowed, used),
    ...(subject ? validateTemplateText(subject, 'subject', allowed, used) : []),
  ];
  if (issues.length) fail(issues);
  return [...used].sort();
}

export class TemplateService {
  constructor(private readonly db: AppClient) {}

  catalog() {
    return {
      items: Object.entries(TEMPLATE_CATALOG).map(([code, e]) => ({
        code,
        channels: [...e.channels],
        variables: Object.entries(e.variables).map(([key, sample]) => ({ key, sample })),
      })),
    };
  }

  async list(filter: { channel?: string; code?: string; locale?: string }) {
    const rows = await this.db.messageTemplate.findMany({
      where: {
        tenantId: requireTenantId(),
        ...(filter.channel ? { channel: filter.channel as CommunicationChannel } : {}),
        ...(filter.code ? { code: filter.code } : {}),
        ...(filter.locale ? { locale: filter.locale } : {}),
      },
      orderBy: [{ code: 'asc' }, { channel: 'asc' }, { locale: 'asc' }],
    });
    return { items: rows.map(toView) };
  }

  async get(id: string) {
    const row = await this.db.messageTemplate.findFirst({
      where: { id, tenantId: requireTenantId() },
    });
    if (!row) throw notFound('Template not found');
    return toView(row);
  }

  async create(req: Request, tenantId: string, input: TemplateInput) {
    checkTemplate(input.channel, input.code, input.subject, input.body);
    const row = await this.db.messageTemplate.create({
      data: {
        tenantId,
        channel: input.channel,
        code: input.code,
        locale: input.locale,
        subject: input.subject ?? null,
        body: input.body,
      },
    });
    recordAudit(req, {
      action: 'branding.template.create',
      entity: 'message_template',
      entityId: row.id,
      after: { channel: row.channel, code: row.code, locale: row.locale },
    });
    return toView(row);
  }

  async update(
    req: Request,
    id: string,
    input: { subject?: string | null | undefined; body: string },
  ) {
    const current = await this.get(id);
    const subject = input.subject === undefined ? current.subject : input.subject;
    checkTemplate(current.channel, current.code, subject, input.body);
    const row = await this.db.messageTemplate.update({
      where: { id },
      data: { subject, body: input.body },
    });
    recordAudit(req, {
      action: 'branding.template.update',
      entity: 'message_template',
      entityId: id,
      before: { body: current.body, subject: current.subject },
      after: { body: row.body, subject: row.subject },
    });
    return toView(row);
  }

  async remove(req: Request, id: string): Promise<void> {
    const current = await this.get(id);
    await this.db.messageTemplate.delete({ where: { id } });
    recordAudit(req, {
      action: 'branding.template.delete',
      entity: 'message_template',
      entityId: id,
      before: { channel: current.channel, code: current.code, locale: current.locale },
    });
  }

  /** Renders a draft with sample data (overridable per whitelisted variable); output escaped. */
  preview(input: TemplatePreviewInput) {
    const variablesUsed = checkTemplate(input.channel, input.code, input.subject, input.body);
    const samples = catalogEntry(input.code)?.variables ?? {};
    const overrides = input.data ?? {};
    const unknown = Object.keys(overrides).filter((k) => !(k in samples));
    if (unknown.length)
      fail(
        unknown.map((k) => ({
          path: `data.${k}`,
          message: `Variable "${k}" is not allowed for this template`,
          code: 'template_variable',
        })),
      );
    const context = buildContext({ ...samples, ...overrides });
    return {
      subject: input.subject ? renderTemplate(input.subject, context) : null,
      body: renderTemplate(input.body, context),
      variablesUsed,
    };
  }
}
