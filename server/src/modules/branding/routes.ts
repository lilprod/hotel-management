import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { upload } from '../../lib/upload.js';
import * as c from './controller.js';
import {
  assetParamsSchema,
  assetUploadResponseSchema,
  brandingUpdateSchema,
  brandingViewSchema,
  domainInputSchema,
  domainViewSchema,
  publicAssetParamsSchema,
  publicBrandingSchema,
  signedAssetSchema,
  templateCatalogResponseSchema,
  templateIdParamsSchema,
  templateInputSchema,
  templateListQuerySchema,
  templatePreviewResponseSchema,
  templatePreviewSchema,
  templateUpdateSchema,
  templateViewSchema,
} from './schemas.js';
import { MAX_UPLOAD_BYTES, UPLOAD_MIME_TYPES } from './service.js';
import { z } from 'zod';

const read = can('branding.read');
const manage = can('branding.manage');
const customDomain = requireFeature('branding.custom_domain');

/** Staff surface: /api/v1/t/branding */
export const brandingRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'Tenant branding, legal mentions and contrast report',
    middleware: [read],
    responses: { 200: { description: 'Branding', schema: brandingViewSchema } },
    handler: (req) => c.getBranding(req),
  })
  .route({
    method: 'put',
    path: '/',
    summary: 'Update colours, document header/footer, legal mentions, sender name, login message',
    description:
      'Provided fields are replaced (null clears). The response carries WCAG contrast warnings for the primary colour.',
    middleware: [manage],
    request: { body: brandingUpdateSchema },
    responses: { 200: { description: 'Updated branding', schema: brandingViewSchema } },
    handler: (req) => c.updateBranding(req, req.valid.body),
  })
  .route({
    method: 'post',
    path: '/assets/:kind',
    summary: 'Upload a logo, favicon, login background or signature (multipart field `file`)',
    middleware: [
      manage,
      upload({ field: 'file', maxBytes: MAX_UPLOAD_BYTES, mimeTypes: UPLOAD_MIME_TYPES }),
    ],
    request: { params: assetParamsSchema },
    status: 201,
    responses: { 201: { description: 'Stored asset', schema: assetUploadResponseSchema } },
    handler: (req) => c.uploadAsset(req, req.valid.params.kind),
  })
  .route({
    method: 'delete',
    path: '/assets/:kind',
    summary: 'Remove an asset',
    middleware: [manage],
    request: { params: assetParamsSchema },
    responses: { 204: { description: 'Removed' } },
    handler: (req, res) => c.deleteAsset(req, res, req.valid.params.kind),
  })
  .route({
    method: 'get',
    path: '/assets/:kind',
    summary: 'Short-lived signed URL of an asset',
    middleware: [read],
    request: { params: assetParamsSchema },
    responses: { 200: { description: 'Signed URL', schema: signedAssetSchema } },
    handler: (req) => c.getSignedAsset(req, req.valid.params.kind),
  })
  // --- message templates ---
  .route({
    method: 'get',
    path: '/templates/catalog',
    summary: 'Template codes, channels and whitelisted variables',
    middleware: [read],
    responses: { 200: { description: 'Catalog', schema: templateCatalogResponseSchema } },
    handler: (req) => c.templateCatalog(req),
  })
  .route({
    method: 'post',
    path: '/templates/preview',
    summary: 'Render a draft template with sample data (HTML-escaped)',
    middleware: [manage],
    request: { body: templatePreviewSchema },
    responses: { 200: { description: 'Rendered', schema: templatePreviewResponseSchema } },
    handler: (req) => c.previewTemplate(req, req.valid.body),
  })
  .route({
    method: 'get',
    path: '/templates',
    summary: 'List message templates',
    middleware: [read],
    request: { query: templateListQuerySchema },
    responses: {
      200: { description: 'Templates', schema: z.object({ items: z.array(templateViewSchema) }) },
    },
    handler: (req) => c.listTemplates(req, req.valid.query),
  })
  .route({
    method: 'post',
    path: '/templates',
    summary: 'Create a template for a channel / code / locale',
    middleware: [manage],
    request: { body: templateInputSchema },
    status: 201,
    responses: { 201: { description: 'Created', schema: templateViewSchema } },
    handler: (req) => c.createTemplate(req, req.valid.body),
  })
  .route({
    method: 'get',
    path: '/templates/:id',
    summary: 'Get a template',
    middleware: [read],
    request: { params: templateIdParamsSchema },
    responses: { 200: { description: 'Template', schema: templateViewSchema } },
    handler: (req) => c.getTemplate(req, req.valid.params.id),
  })
  .route({
    method: 'put',
    path: '/templates/:id',
    summary: 'Update the subject / body of a template',
    middleware: [manage],
    request: { params: templateIdParamsSchema, body: templateUpdateSchema },
    responses: { 200: { description: 'Updated', schema: templateViewSchema } },
    handler: (req) => c.updateTemplate(req, req.valid.params.id, req.valid.body),
  })
  .route({
    method: 'delete',
    path: '/templates/:id',
    summary: 'Delete a template',
    middleware: [manage],
    request: { params: templateIdParamsSchema },
    responses: { 204: { description: 'Deleted' } },
    handler: (req, res) => c.deleteTemplate(req, res, req.valid.params.id),
  })
  // --- custom domain (PREMIUM) ---
  .route({
    method: 'get',
    path: '/domain',
    summary: 'Sub-domain and custom domain status',
    middleware: [read, customDomain],
    responses: { 200: { description: 'Domains', schema: domainViewSchema } },
    handler: (req) => c.getDomain(req),
  })
  .route({
    method: 'post',
    path: '/domain',
    summary: 'Add a custom domain (returns the TXT record to publish)',
    middleware: [manage, customDomain],
    request: { body: domainInputSchema },
    status: 201,
    responses: { 201: { description: 'Pending domain', schema: domainViewSchema } },
    handler: (req) => c.addDomain(req, req.valid.body.hostname),
  })
  .route({
    method: 'post',
    path: '/domain/verify',
    summary: 'Check the DNS TXT challenge and activate the domain',
    middleware: [manage, customDomain],
    responses: { 200: { description: 'Domain status', schema: domainViewSchema } },
    handler: (req) => c.verifyDomain(req),
  })
  .route({
    method: 'delete',
    path: '/domain',
    summary: 'Remove the custom domain',
    middleware: [manage, customDomain],
    responses: { 204: { description: 'Removed' } },
    handler: (req, res) => c.removeDomain(req, res),
  });

/** Portal surface (public, no auth): /api/v1/portal/branding */
export const publicBrandingRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'Public branding of the tenant resolved from the Host header',
    public: true,
    responses: { 200: { description: 'Public branding', schema: publicBrandingSchema } },
    handler: (req, res) => c.publicBranding(req, res),
  })
  .route({
    method: 'get',
    path: '/assets/:kind',
    summary: 'Redirects to a signed URL of a public asset (logo, favicon, login background)',
    public: true,
    request: { params: publicAssetParamsSchema },
    responses: { 302: { description: 'Redirect to the asset' } },
    handler: (req, res) => c.publicAsset(req, res, req.valid.params.kind),
  });
