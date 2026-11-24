import { describe, expect, it } from 'vitest';

import type { AvailableRoom } from './api';
import {
  checkoutAction,
  emptyIdentity,
  hasErrors,
  parseGuestPath,
  prefillIdentity,
  roomSelectable,
  sortRooms,
  toGuestBody,
  validateIdentity,
} from './model';

const complete = {
  ...emptyIdentity(),
  firstName: 'Kofi',
  lastName: 'Agbeko',
  birthDate: '1985-03-02',
  birthPlace: 'Lomé',
  nationality: 'TG',
  address: 'Rue 1',
  idDocType: 'PASSPORT',
  idDocNumber: 'TG123',
};

describe('police form validation', () => {
  it('requires the mandatory police fields and reports i18n keys', () => {
    const e = validateIdentity(emptyIdentity());
    expect(Object.keys(e).sort()).toEqual(
      ['address', 'birthDate', 'birthPlace', 'firstName', 'idDocNumber', 'idDocType', 'lastName', 'nationality'].sort(),
    );
    expect(e.nationality).toBe('validation.nationality');
    expect(hasErrors(validateIdentity(complete))).toBe(false);
  });

  it('accepts an empty document number when the profile already stores one', () => {
    const id = { ...complete, idDocNumber: '' };
    expect(validateIdentity(id).idDocNumber).toBe('validation.idNumber');
    expect(validateIdentity(id, { storedNumber: true }).idDocNumber).toBeUndefined();
  });

  it('rejects a lower-case or too long nationality and a malformed issue date', () => {
    expect(validateIdentity({ ...complete, nationality: 'tg' }).nationality).toBeDefined();
    expect(validateIdentity({ ...complete, idIssuedOn: '12/05/2020' }).idIssuedOn).toBe('validation.date');
  });
});

describe('prefill and request body', () => {
  it('prefills from the guest profile without ever copying the masked number', () => {
    const id = prefillIdentity({
      id: 'g1',
      firstName: 'Ama',
      lastName: 'Mensah',
      birthDate: '1990-01-01',
      birthPlace: null,
      nationality: 'GH',
      profession: null,
      address: 'Accra',
      idDocType: 'CNI',
      idDocNumberMasked: '••••4567',
    });
    expect(id).toMatchObject({ guestId: 'g1', lastName: 'Mensah', birthPlace: '', idDocNumber: '' });
  });

  it('omits empty strings so the server prefills them from the profile', () => {
    expect(toGuestBody({ ...emptyIdentity(), guestId: 'g1', firstName: ' Ama ', idDocNumber: 'X1' })).toEqual({
      guestId: 'g1',
      firstName: 'Ama',
      idDocNumber: 'X1',
    });
  });

  it('maps a server field error path to the guest and field', () => {
    expect(parseGuestPath('guests.1.birthDate')).toEqual([1, 'birthDate']);
    expect(parseGuestPath('police.customFields.x')).toBeNull();
  });
});

describe('room choice', () => {
  const room = (id: string, number: string, clean: boolean): AvailableRoom => ({
    id,
    number,
    roomTypeId: 't',
    roomTypeName: 'Standard',
    floor: null,
    hkStatus: clean ? 'CLEAN' : 'DIRTY',
    clean,
  });

  it('suggests clean rooms first, the assigned one before the others, dirty ones last', () => {
    const sorted = sortRooms([room('a', '101', false), room('b', '103', true), room('c', '102', true)], 'b');
    expect(sorted.map((r) => r.number)).toEqual(['103', '102', '101']);
  });

  it('lets only an authorised user pick a dirty room', () => {
    expect(roomSelectable(room('a', '101', false), false)).toBe(false);
    expect(roomSelectable(room('a', '101', false), true)).toBe(true);
    expect(roomSelectable(room('b', '102', true), false)).toBe(true);
  });
});

describe('check-out decision', () => {
  const unpaid = { balance: 36_000, blockers: [{ code: 'UNPAID_BALANCE' as const, message: 'x', amount: 36_000 }] };

  it('goes straight through when nothing blocks', () => {
    expect(checkoutAction({ balance: 0, blockers: [] }, { canOverride: false })).toBe('checkout');
  });

  it('blocks an unpaid balance unless transferred to a company with a NIF or overridden with a reason', () => {
    expect(checkoutAction(unpaid, { canOverride: false })).toBe('blocked');
    expect(checkoutAction(unpaid, { companyId: 'c1', companyHasNif: false, canOverride: false })).toBe('blocked');
    expect(checkoutAction(unpaid, { companyId: 'c1', companyHasNif: true, canOverride: false })).toBe('transfer');
    expect(checkoutAction(unpaid, { canOverride: true, overrideReason: '' })).toBe('blocked');
    expect(checkoutAction(unpaid, { canOverride: true, overrideReason: 'Accord direction' })).toBe('override');
    expect(checkoutAction(unpaid, { canOverride: false, overrideReason: 'Accord direction' })).toBe('blocked');
  });

  it('never transfers to the city ledger when another blocker exists (open POS orders)', () => {
    const mixed = {
      balance: 100,
      blockers: [
        { code: 'UNPAID_BALANCE' as const, message: 'x' },
        { code: 'OPEN_POS_ORDERS' as const, message: 'y', count: 1 },
      ],
    };
    expect(checkoutAction(mixed, { companyId: 'c1', companyHasNif: true, canOverride: false })).toBe('blocked');
  });
});
