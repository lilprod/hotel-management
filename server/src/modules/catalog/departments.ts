import { createModuleRouter } from '../../core/router.js';
import { defineModule } from '../../core/module.js';
import { canAny, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest, withCtx } from '../property/common.js';
import * as s from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');

export const departmentsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'Departments of a property with their translated names (folio lines, charge form)',
    middleware: [
      canAny(
        ['folio.read', 'folio.post', 'folio.pay', 'cash.read', 'cash.session', 'front_desk.read', 'catalog.read', 'settings.read'],
        { property: propertyFromRequest },
      ),
      feature,
    ],
    request: { query: s.listDepartmentsQuery },
    responses: { 200: { description: 'Departments', schema: s.departmentList } },
    handler: (req) => withCtx(req, (c) => service.listDepartments(c, req.valid.query)),
  });

/** `GET /api/v1/t/departments?propertyId`: department names for folio lines and charge forms. */
export const departmentsModule = defineModule({
  key: 'departments',
  router: { t: departmentsRouter },
  permissions: ['catalog.read'],
  features: ['lodging.core'],
});
