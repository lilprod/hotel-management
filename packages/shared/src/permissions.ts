/**
 * Permission catalog `module.action[.scope]` (doc 05 §2).
 * Wildcards: `*` (all), `module.*` (whole module), `module.sub.*`.
 */
export const PERMISSION_CATALOG = {
  lodging: ['read', 'manage', 'rates.manage', 'blocks.manage'],
  reservations: ['read', 'create', 'update', 'cancel', 'assign', 'export'],
  front_desk: ['read', 'check_in', 'check_out', 'move', 'police_form'],
  waitlist: ['read', 'manage'],
  folio: ['read', 'post', 'pay', 'charge_room', 'discount', 'reverse'],
  pos: ['pay', 'void'],
  cash: ['read', 'session', 'close', 'close_with_variance', 'movements'],
  invoices: ['read', 'issue', 'credit_note', 'export'],
  night_audit: ['read', 'run'],
  guests: ['read', 'create', 'update', 'merge', 'export', 'anonymize'],
  groups: ['read', 'manage'],
  city_ledger: ['read', 'manage'],
  loyalty: ['read', 'manage', 'adjust'],
  hr: ['read', 'manage', 'schedules.manage', 'timeclock.read', 'timeclock.edit', 'leaves.manage'],
  tasks: ['read', 'create', 'update', 'update_own', 'assign'],
  messaging: ['read', 'send', 'manage'],
  restaurant: [
    'orders.read',
    'orders.create',
    'orders.update',
    'orders.void',
    'tables.manage',
    'reservations.manage',
    'menu.manage',
  ],
  spa: [
    'appointments.read',
    'appointments.manage',
    'records.read',
    'records.write',
    'services.manage',
  ],
  activities: ['read', 'manage', 'bookings.manage'],
  inventory: ['read', 'manage', 'consume', 'adjust', 'purchase_orders.manage'],
  assets: ['read', 'manage'],
  maintenance: ['read', 'create', 'update', 'assign', 'preventive.manage'],
  housekeeping: ['read', 'update', 'assign', 'inspect'],
  reports: ['read', 'export', 'schedule'],
  exports: ['read', 'create'],
  branding: ['read', 'manage'],
  security: ['read', 'manage'],
  users: ['read', 'manage'],
  roles: ['read', 'manage'],
  billing: ['read', 'manage'],
  settings: ['read', 'manage'],
  imports: ['read', 'run'],
  accounting: ['read', 'manage', 'export'],
  audit: ['read', 'export'],
  integrations: ['read', 'manage'],
} as const satisfies Record<string, readonly string[]>;

export type PermissionModule = keyof typeof PERMISSION_CATALOG;

export type Permission = {
  [M in PermissionModule]: `${M}.${(typeof PERMISSION_CATALOG)[M][number]}`;
}[PermissionModule];

export const ALL_PERMISSIONS: readonly Permission[] = (
  Object.entries(PERMISSION_CATALOG) as [string, readonly string[]][]
).flatMap(([m, actions]) => actions.map((a) => `${m}.${a}` as Permission));

/**
 * Always audited, possibly 2FA-gated (doc 05 §2).
 * Doc writes `invoice.credit_note`; normalized here to the module name `invoices`.
 */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  'folio.discount',
  'folio.reverse',
  'invoices.credit_note',
  'cash.close_with_variance',
  'pos.void',
  'night_audit.run',
  'loyalty.adjust',
  'spa.records.read',
  'hr.timeclock.edit',
  'users.manage',
  'security.manage',
  'billing.manage',
  'guests.export',
];

export function isSensitivePermission(permission: string): boolean {
  return (SENSITIVE_PERMISSIONS as readonly string[]).includes(permission);
}

/**
 * Does one granted entry (possibly a wildcard) cover `required` (a concrete permission)?
 * `*` covers everything; `a.*` covers `a.<anything>` (and `a` itself).
 */
export function matchesPermission(granted: string, required: string): boolean {
  if (granted === '*' || granted === required) return true;
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -2);
    return required === prefix || required.startsWith(`${prefix}.`);
  }
  return false;
}

export function hasPermission(granted: Iterable<string>, required: string): boolean {
  for (const g of granted) if (matchesPermission(g, required)) return true;
  return false;
}

export function hasAllPermissions(granted: Iterable<string>, required: readonly string[]): boolean {
  const list = [...granted];
  return required.every((r) => hasPermission(list, r));
}

export const SYSTEM_ROLE_KEYS = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'FRONT_DESK',
  'HOUSEKEEPING',
  'RESTAURANT_STAFF',
  'SPA_STAFF',
  'MAINTENANCE',
  'CASHIER',
  'ACCOUNTANT',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

const OPERATIONAL_MODULES: readonly PermissionModule[] = [
  'lodging',
  'reservations',
  'front_desk',
  'waitlist',
  'folio',
  'pos',
  'cash',
  'invoices',
  'night_audit',
  'guests',
  'groups',
  'city_ledger',
  'loyalty',
  'hr',
  'tasks',
  'messaging',
  'restaurant',
  'spa',
  'activities',
  'inventory',
  'assets',
  'maintenance',
  'housekeeping',
];

const ADMIN_MODULES: readonly PermissionModule[] = [
  ...OPERATIONAL_MODULES,
  'reports',
  'exports',
  'branding',
  'security',
  'users',
  'roles',
  'settings',
  'imports',
  'accounting',
  'audit',
  'integrations',
];

/** System roles → permissions (doc 05 §2). Admin = everything except `billing.*` (subscription). */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, readonly string[]> = {
  OWNER: ['*'],
  ADMIN: ADMIN_MODULES.map((m) => `${m}.*`),
  MANAGER: [
    ...OPERATIONAL_MODULES.map((m) => `${m}.*`),
    'reports.*',
    'exports.*',
    'users.read',
    'settings.read',
    'audit.read',
  ],
  FRONT_DESK: [
    'reservations.*',
    'front_desk.*',
    'guests.*',
    'folio.post',
    'folio.pay',
    'cash.session',
    'waitlist.*',
  ],
  HOUSEKEEPING: ['housekeeping.*', 'maintenance.create', 'tasks.update_own', 'inventory.consume'],
  RESTAURANT_STAFF: [
    'restaurant.orders.*',
    'restaurant.tables.*',
    'restaurant.reservations.*',
    'folio.charge_room',
    'pos.pay',
  ],
  SPA_STAFF: ['spa.appointments.*', 'spa.records.read', 'spa.records.write', 'folio.charge_room'],
  MAINTENANCE: ['maintenance.*', 'assets.read', 'inventory.consume'],
  CASHIER: ['folio.pay', 'cash.*'],
  ACCOUNTANT: ['reports.*', 'invoices.read', 'city_ledger.*', 'exports.*'],
};
