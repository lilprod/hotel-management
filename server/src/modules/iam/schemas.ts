import { isIP } from 'node:net';
import { z } from 'zod';
import { emailSchema } from '../auth/schemas.js';

export const idParams = z.object({ id: z.string().uuid() });

const ids = z.array(z.string().uuid()).max(200);

export const userListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']).optional(),
  roleId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
});

export const createUserBody = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional(),
  roleIds: ids.min(1),
  propertyIds: ids.default([]),
});

export const updateUserBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    roleIds: ids.min(1).optional(),
    propertyIds: ids.optional(),
    mustChangePassword: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

export const propertiesBody = z.object({ propertyIds: ids });

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']),
  mfaEnabled: z.boolean(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  roles: z.array(z.object({ id: z.string(), name: z.string(), isSystem: z.boolean() })),
  propertyIds: z.array(z.string()),
});
export const userListResponse = z.object({ items: z.array(userSchema) });

const permissionKey = z.string().trim().min(1).max(100);

export const createRoleBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(permissionKey).max(500).default([]),
});
export const cloneRoleBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});
export const updateRoleBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
export const rolePermissionsBody = z.object({ permissions: z.array(permissionKey).max(500) });

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  userCount: z.number().int(),
});
export const roleListResponse = z.object({ items: z.array(roleSchema) });

/** CIDR or single address (`10.0.0.0/8`, `2001:db8::/32`, `203.0.113.7`). */
export const cidrSchema = z
  .string()
  .trim()
  .refine((s) => {
    const [addr, bits, extra] = s.split('/');
    if (extra !== undefined || !addr) return false;
    const v = isIP(addr);
    if (!v) return false;
    if (bits === undefined) return true;
    if (!/^\d{1,3}$/.test(bits)) return false;
    return Number(bits) <= (v === 4 ? 32 : 128);
  }, 'Invalid IP address or CIDR range');

export const policyBody = z
  .object({
    pwdMinLength: z.number().int().min(8).max(128),
    pwdRequireClasses: z.number().int().min(1).max(4),
    pwdExpiryDays: z.number().int().min(1).max(3650).nullable(),
    pwdHistory: z.number().int().min(0).max(24),
    mfaMode: z.enum(['OFF', 'OPTIONAL', 'REQUIRED_FOR_ROLES', 'REQUIRED_ALL']),
    mfaRoles: ids,
    sessionIdleMinutes: z.number().int().min(5).max(1440),
    maxSessions: z.number().int().min(1).max(100).nullable(),
    lockoutThreshold: z.number().int().min(3).max(20),
    lockoutMinutes: z.number().int().min(1).max(1440),
    ipAllowlist: z.array(cidrSchema).max(50),
    allowImpersonation: z.boolean(),
  })
  .partial();

export const policySchema = z.object({
  pwdMinLength: z.number(),
  pwdRequireClasses: z.number(),
  pwdExpiryDays: z.number().nullable(),
  pwdHistory: z.number(),
  mfaMode: z.string(),
  mfaRoles: z.array(z.string()),
  sessionIdleMinutes: z.number(),
  maxSessions: z.number().nullable(),
  lockoutThreshold: z.number(),
  lockoutMinutes: z.number(),
  ipAllowlist: z.array(z.string()),
  allowImpersonation: z.boolean(),
});

export const impersonationListResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      at: z.string(),
      platformUserId: z.string().nullable(),
      userId: z.string().nullable(),
      sessionId: z.string().nullable(),
      details: z.unknown(),
    }),
  ),
});
