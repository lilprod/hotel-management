import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { anyStaff } from '../../http/helpers.js';
import { acceptDocuments, legalStatus, listDocuments } from './service.js';

const docSummary = z.object({
  id: z.string(),
  type: z.string(),
  version: z.string(),
  locale: z.string(),
  publishedAt: z.string(),
});
const statusSchema = z.object({
  blocked: z.boolean(),
  canAccept: z.boolean(),
  pending: z.array(docSummary),
});
const tags = ['legal'];

/** Versioned TOS / DPA acceptance (doc 08 EX-04). Reachable while the staff API is blocked. */
export const legalRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/status',
    tags,
    summary: 'Pending legal documents of the tenant',
    middleware: [anyStaff()],
    responses: { 200: { description: 'Status', schema: statusSchema } },
    handler: (req) => legalStatus(req),
  })
  .route({
    method: 'get',
    path: '/documents',
    tags,
    summary: 'Latest TOS / DPA with their content and acceptance state',
    middleware: [anyStaff()],
    responses: {
      200: {
        description: 'Documents',
        schema: z.object({
          items: z.array(docSummary.extend({ content: z.string(), accepted: z.boolean() })),
        }),
      },
    },
    handler: (req) => listDocuments(req),
  })
  .route({
    method: 'post',
    path: '/accept',
    tags,
    summary: 'Accept the latest documents (owner only; records user, version and IP)',
    middleware: [anyStaff()],
    request: { body: z.object({ documentIds: z.array(z.string().uuid()).min(1).max(10) }) },
    responses: { 200: { description: 'Status after acceptance', schema: statusSchema } },
    handler: (req) => acceptDocuments(req, req.valid.body.documentIds),
  });
