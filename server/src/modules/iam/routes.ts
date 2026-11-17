import { runWithTenant } from '@hm/database';
import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can, checkQuota, requireFeature } from '../../http/helpers.js';
import {
  cloneRoleBody,
  createRoleBody,
  createUserBody,
  idParams,
  impersonationListResponse,
  policyBody,
  policySchema,
  propertiesBody,
  roleListResponse,
  rolePermissionsBody,
  roleSchema,
  updateRoleBody,
  updateUserBody,
  userListQuery,
  userListResponse,
  userSchema,
} from './schemas.js';
import * as iam from './service.js';

const CUSTOM_ROLES = 'security.custom_roles';
const users = ['iam: users'];
const roles = ['iam: roles'];
const security = ['iam: security'];
const user200 = { 200: { description: 'User', schema: userSchema } };
const role200 = { 200: { description: 'Role', schema: roleSchema } };

/** Users, roles, permissions, security policy (`/api/v1/t/iam`, doc 01 TN-10…TN-18). */
export const iamRouter = createModuleRouter()
  // ----- users -----
  .route({
    method: 'get',
    path: '/users',
    tags: users,
    summary: 'List users',
    middleware: [can('users.read')],
    request: { query: userListQuery },
    responses: { 200: { description: 'Users', schema: userListResponse } },
    handler: (req) => iam.listUsers(req, req.valid.query),
  })
  .route({
    method: 'post',
    path: '/users',
    tags: users,
    summary: 'Invite a user (e-mail with a 7-day link)',
    middleware: [can('users.manage'), checkQuota('users', { used: (req) => iam.countSeats(req) })],
    request: { body: createUserBody },
    status: 201,
    responses: { 201: { description: 'Invited user', schema: userSchema } },
    handler: (req) => iam.createUser(req, req.valid.body),
  })
  .route({
    method: 'get',
    path: '/users/:id',
    tags: users,
    summary: 'Get a user',
    middleware: [can('users.read')],
    request: { params: idParams },
    responses: user200,
    handler: (req) => iam.getUser(req, req.valid.params.id),
  })
  .route({
    method: 'patch',
    path: '/users/:id',
    tags: users,
    summary: 'Update a user (name, phone, roles, properties, forced password change)',
    middleware: [can('users.manage')],
    request: { params: idParams, body: updateUserBody },
    responses: user200,
    handler: (req) => iam.updateUser(req, req.valid.params.id, req.valid.body),
  })
  .route({
    method: 'delete',
    path: '/users/:id',
    tags: users,
    summary: 'Remove a user (deactivated and hidden; history kept)',
    middleware: [can('users.manage')],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      const { id } = req.valid.params;
      await iam.setUserStatus(req, id, false);
      await runWithTenant(req.tenant!.id, () =>
        req.services.db.user.update({ where: { id }, data: { deletedAt: new Date() } }),
      );
      res.status(204).end();
    },
  })
  .route({
    method: 'post',
    path: '/users/:id/invitation',
    tags: users,
    summary: 'Re-send the invitation e-mail (previous link invalidated)',
    middleware: [can('users.manage')],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      await iam.resendInvitation(req, req.valid.params.id);
      res.status(204).end();
    },
  })
  .route({
    method: 'post',
    path: '/users/:id/activate',
    tags: users,
    summary: 'Re-activate a user',
    middleware: [can('users.manage'), checkQuota('users', { used: (req) => iam.countSeats(req) })],
    request: { params: idParams },
    responses: user200,
    handler: (req) => iam.setUserStatus(req, req.valid.params.id, true),
  })
  .route({
    method: 'post',
    path: '/users/:id/deactivate',
    tags: users,
    summary: 'Deactivate a user (every session revoked)',
    middleware: [can('users.manage')],
    request: { params: idParams },
    responses: user200,
    handler: (req) => iam.setUserStatus(req, req.valid.params.id, false),
  })
  .route({
    method: 'put',
    path: '/users/:id/properties',
    tags: users,
    summary: 'Replace the properties a user is attached to',
    middleware: [can('users.manage')],
    request: { params: idParams, body: propertiesBody },
    responses: user200,
    handler: (req) => iam.setUserProperties(req, req.valid.params.id, req.valid.body.propertyIds),
  })
  .route({
    method: 'delete',
    path: '/users/:id/sessions',
    tags: users,
    summary: 'Revoke every session of a user',
    middleware: [can('users.manage')],
    request: { params: idParams },
    responses: {
      200: { description: 'Revoked', schema: z.object({ revoked: z.number().int() }) },
    },
    handler: (req) => iam.revokeUserSessions(req, req.valid.params.id),
  })
  .route({
    method: 'post',
    path: '/users/:id/mfa/reset',
    tags: users,
    summary: 'Reset the 2FA of a user (lost device)',
    middleware: [can('security.manage')],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      await iam.resetUserMfa(req, req.valid.params.id);
      res.status(204).end();
    },
  })
  // ----- roles -----
  .route({
    method: 'get',
    path: '/permissions',
    tags: roles,
    summary: 'Permission catalog for the role editor',
    middleware: [can('roles.read')],
    handler: () => iam.permissionCatalog(),
  })
  .route({
    method: 'get',
    path: '/roles',
    tags: roles,
    summary: 'List roles (system + custom)',
    middleware: [can('roles.read')],
    responses: { 200: { description: 'Roles', schema: roleListResponse } },
    handler: (req) => iam.listRoles(req),
  })
  .route({
    method: 'post',
    path: '/roles',
    tags: roles,
    summary: 'Create a custom role',
    middleware: [can('roles.manage'), requireFeature(CUSTOM_ROLES)],
    request: { body: createRoleBody },
    status: 201,
    responses: { 201: { description: 'Role', schema: roleSchema } },
    handler: (req) => iam.createRole(req, req.valid.body),
  })
  .route({
    method: 'get',
    path: '/roles/:id',
    tags: roles,
    summary: 'Get a role',
    middleware: [can('roles.read')],
    request: { params: idParams },
    responses: role200,
    handler: (req) => iam.getRole(req, req.valid.params.id),
  })
  .route({
    method: 'post',
    path: '/roles/:id/clone',
    tags: roles,
    summary: 'Clone a role (system roles included) into a custom role',
    middleware: [can('roles.manage'), requireFeature(CUSTOM_ROLES)],
    request: { params: idParams, body: cloneRoleBody },
    status: 201,
    responses: { 201: { description: 'Role', schema: roleSchema } },
    handler: (req) => iam.cloneRole(req, req.valid.params.id, req.valid.body),
  })
  .route({
    method: 'patch',
    path: '/roles/:id',
    tags: roles,
    summary: 'Rename / describe a custom role',
    middleware: [can('roles.manage'), requireFeature(CUSTOM_ROLES)],
    request: { params: idParams, body: updateRoleBody },
    responses: role200,
    handler: (req) => iam.updateRole(req, req.valid.params.id, req.valid.body),
  })
  .route({
    method: 'put',
    path: '/roles/:id/permissions',
    tags: roles,
    summary: 'Replace the permissions of a custom role (bumps perm_ver)',
    middleware: [can('roles.manage'), requireFeature(CUSTOM_ROLES)],
    request: { params: idParams, body: rolePermissionsBody },
    responses: role200,
    handler: (req) => iam.setRolePermissions(req, req.valid.params.id, req.valid.body.permissions),
  })
  .route({
    method: 'delete',
    path: '/roles/:id',
    tags: roles,
    summary: 'Delete a custom role (system roles and assigned roles are refused)',
    middleware: [can('roles.manage')],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      await iam.deleteRole(req, req.valid.params.id);
      res.status(204).end();
    },
  })
  // ----- security policy -----
  .route({
    method: 'get',
    path: '/security-policy',
    tags: security,
    summary: 'Security policy of the tenant',
    middleware: [can('security.read')],
    responses: { 200: { description: 'Policy', schema: policySchema } },
    handler: (req) => iam.getPolicy(req),
  })
  .route({
    method: 'put',
    path: '/security-policy',
    tags: security,
    summary: 'Update the security policy (IP allowlist needs security.ip_restriction)',
    middleware: [can('security.manage')],
    request: { body: policyBody },
    responses: { 200: { description: 'Policy', schema: policySchema } },
    handler: (req) => iam.updatePolicy(req, req.valid.body),
  })
  .route({
    method: 'get',
    path: '/impersonations',
    tags: security,
    summary: 'Support impersonation sessions on this tenant',
    middleware: [can('security.read')],
    responses: { 200: { description: 'Events', schema: impersonationListResponse } },
    handler: (req) => iam.listImpersonations(req),
  });
