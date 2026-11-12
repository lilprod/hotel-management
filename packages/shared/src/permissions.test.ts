import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  hasAllPermissions,
  hasPermission,
  matchesPermission,
} from './permissions.js';

describe('hasPermission', () => {
  it('matches exact, module wildcard and global wildcard', () => {
    expect(hasPermission(['folio.pay'], 'folio.pay')).toBe(true);
    expect(hasPermission(['folio.*'], 'folio.discount')).toBe(true);
    expect(hasPermission(['*'], 'billing.manage')).toBe(true);
  });

  it('denies other modules and prefixes that are not path segments', () => {
    expect(hasPermission(['folio.*'], 'folios.read')).toBe(false);
    expect(hasPermission(['folio.pay'], 'folio.discount')).toBe(false);
    expect(hasPermission([], 'folio.pay')).toBe(false);
  });

  it('supports nested wildcards', () => {
    expect(matchesPermission('restaurant.orders.*', 'restaurant.orders.void')).toBe(true);
    expect(matchesPermission('restaurant.orders.*', 'restaurant.tables.manage')).toBe(false);
  });

  it('hasAllPermissions requires every permission', () => {
    expect(hasAllPermissions(['a.*', 'b.read'], ['a.x', 'b.read'])).toBe(true);
    expect(hasAllPermissions(['a.*'], ['a.x', 'b.read'])).toBe(false);
  });
});

describe('catalog and roles', () => {
  it('sensitive permissions all exist in the catalog', () => {
    for (const p of SENSITIVE_PERMISSIONS) expect(ALL_PERMISSIONS).toContain(p);
  });

  it('catalog has no duplicates', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('owner has everything, admin has everything but billing', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.OWNER, p)).toBe(true);
      expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.ADMIN, p)).toBe(!p.startsWith('billing.'));
    }
  });

  it('role grants reference real catalog entries', () => {
    for (const grants of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
      for (const g of grants) {
        if (g === '*') continue;
        const matched = ALL_PERMISSIONS.some((p) => matchesPermission(g, p));
        expect(matched, `${g} matches nothing`).toBe(true);
      }
    }
  });

  it('front desk can post but not discount; cashier cannot touch reservations', () => {
    const fd = SYSTEM_ROLE_PERMISSIONS.FRONT_DESK;
    expect(hasPermission(fd, 'folio.post')).toBe(true);
    expect(hasPermission(fd, 'folio.discount')).toBe(false);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.CASHIER, 'reservations.create')).toBe(false);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.CASHIER, 'cash.close_with_variance')).toBe(true);
  });
});
