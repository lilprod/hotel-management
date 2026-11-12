import { z } from 'zod';
import { defineModule } from '../../src/core/module.js';
import { createModuleRouter } from '../../src/core/router.js';
import { anyStaff, can, requireFeature } from '../../src/http/helpers.js';

/** Test-only module exercising validation, permissions, features and DB conflicts. */
export const probeRouter = createModuleRouter()
  .route({
    method: 'post',
    path: '/echo',
    middleware: [can('reservations.create')],
    request: {
      body: z.object({ name: z.string().min(2), nights: z.number().int().positive() }),
    },
    handler: (req) => ({ echo: req.valid.body }),
  })
  .route({
    method: 'get',
    path: '/spa',
    middleware: [anyStaff(), requireFeature('spa')],
    handler: () => ({ ok: true }),
  })
  .route({
    method: 'get',
    path: '/users',
    middleware: [can('users.manage')],
    handler: () => ({ ok: true }),
  })
  .route({
    method: 'post',
    path: '/roles',
    middleware: [can('roles.manage')],
    request: { body: z.object({ name: z.string().min(1) }) },
    status: 201,
    handler: async (req) => {
      const { db } = req.services;
      const tenantId = req.tenant!.id;
      const role = await db.role.create({ data: { tenantId, name: req.valid.body.name } });
      return { id: role.id };
    },
  });

export const probeModule = defineModule({ key: 'probe', router: { t: probeRouter } });
