import { createModuleRouter } from '../../core/router.js';
import { can, canAny, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest, withCtx } from '../property/common.js';
import * as s from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');

export const catalogRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/products',
    summary: 'Products of a property (categories: lookup list `product_category`)',
    // `catalog.read` (read-only product picker of front desk / cashier / outlets) or `settings.read`.
    middleware: [canAny(['catalog.read', 'settings.read'], { property: propertyFromRequest }), feature],
    request: { query: s.listProductsQuery },
    responses: { 200: { description: 'Page', schema: s.productPage } },
    handler: (req) => withCtx(req, (c) => service.listProducts(c, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/products',
    summary: 'Create a product',
    middleware: [can('settings.manage', { property: propertyFromRequest }), feature],
    request: { body: s.createProductBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: s.productSchema } },
    handler: (req) => withCtx(req, (c) => service.createProduct(c, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/products/:id',
    summary: 'Product detail',
    middleware: [can('settings.read'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Product', schema: s.productSchema } },
    handler: (req) => withCtx(req, (c) => service.getProduct(c, req.valid.params.id)),
  })
  .route({
    method: 'patch',
    path: '/products/:id',
    summary: 'Update a product',
    middleware: [can('settings.manage'), feature],
    request: { params: s.idParams, body: s.updateProductBody },
    responses: { 200: { description: 'Updated', schema: s.productSchema } },
    handler: (req) =>
      withCtx(req, (c) => service.updateProduct(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/products/:id',
    summary: 'Deactivate and hide a product',
    middleware: [can('settings.manage'), feature],
    request: { params: s.idParams },
    status: 204,
    responses: { 204: { description: 'Deleted' } },
    handler: async (req, res) => {
      await withCtx(req, (c) => service.deleteProduct(c, req.valid.params.id));
      res.status(204).end();
    },
  });
