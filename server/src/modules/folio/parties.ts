import type { TransactionClient } from '@hm/database';
import type { DocParty } from '@hm/templates';
import type { Services } from '../../core/container.js';
import { legalOf } from '../branding/schemas.js';
import { must } from '../property/common.js';
import type { Db, FolioRow } from './repository.js';

export interface CustomerSnapshot {
  type: 'guest' | 'company' | 'other';
  id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** NIF of a company customer (mandatory mention on a company invoice, doc 09 §3). */
  taxId: string | null;
}

type GuestRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export const guestSnapshot = (g: GuestRow): CustomerSnapshot => ({
  type: 'guest',
  id: g.id,
  name: `${g.firstName} ${g.lastName}`.trim(),
  email: g.email,
  phone: g.phone,
  address: g.address,
  taxId: null,
});

export const companySnapshot = (c: {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  contact: unknown;
}): CustomerSnapshot => {
  const contact = (c.contact ?? {}) as { email?: unknown; phone?: unknown };
  return {
    type: 'company',
    id: c.id,
    name: c.name,
    email: typeof contact.email === 'string' ? contact.email : null,
    phone: typeof contact.phone === 'string' ? contact.phone : null,
    address: c.address,
    taxId: c.taxId,
  };
};

type PartyDb = Db & Pick<TransactionClient, 'guest' | 'reservationGuest'>;

/** Default customer of a folio: company of an account, primary guest of a stay, booker. */
export async function defaultCustomer(
  db: PartyDb,
  folio: FolioRow,
  links: { reservationId: string | null; reservationRoomId: string | null },
): Promise<CustomerSnapshot> {
  if (folio.companyId) {
    const c = must(await db.company.findFirst({ where: { id: folio.companyId } }), 'Company');
    return companySnapshot(c);
  }
  if (folio.groupId) {
    const g = must(
      await db.group.findFirst({ where: { id: folio.groupId }, include: { company: true } }),
      'Group',
    );
    if (g.company) return companySnapshot(g.company);
    return { type: 'other', id: g.id, name: g.name, email: null, phone: null, address: null, taxId: null };
  }
  if (links.reservationRoomId) {
    const rg = await db.reservationGuest.findFirst({
      where: { reservationRoomId: links.reservationRoomId },
      include: { guest: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    if (rg) return guestSnapshot(rg.guest);
  }
  if (links.reservationId) {
    const r = await db.reservation.findFirst({
      where: { id: links.reservationId },
      include: { bookerGuest: true },
    });
    if (r?.bookerGuest) return guestSnapshot(r.bookerGuest);
  }
  return { type: 'other', id: null, name: folio.number, email: null, phone: null, address: null, taxId: null };
}

export const customerParty = (c: CustomerSnapshot): DocParty => ({
  name: c.name,
  ...(c.address ? { address: c.address } : {}),
  ...(c.phone ? { phone: c.phone } : {}),
  ...(c.email ? { email: c.email } : {}),
  ...(c.taxId ? { legalIds: { nif: c.taxId } } : {}),
});

/**
 * Seller identity on hotel documents: the hotel (property name, contact) with the legal identity
 * of the tenant (raison sociale `tenants.legal_name`; forme, NIF, RCCM, régime fiscal, address
 * from the branding columns),
 * the property's own NIF/RCCM taking precedence. Never the platform name.
 */
export async function sellerParty(services: Services, db: Pick<Db, 'property'>, tenantId: string, propertyId: string): Promise<DocParty> {
  const p = must(await db.property.findFirst({ where: { id: propertyId } }), 'Property');
  const t = await services.admin.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, legalName: true },
  });
  const legal = legalOf(await services.admin.branding.findUnique({ where: { tenantId } }));
  // The city is appended only when the address does not already state it.
  const address =
    [p.address, p.city && !p.address?.toLowerCase().includes(p.city.toLowerCase()) ? p.city : null]
      .filter(Boolean)
      .join(', ') ||
    legal.address ||
    '';
  const nif = p.taxId ?? legal.nif;
  const rccm = p.rccm ?? legal.rccm;
  return {
    name: p.name,
    ...(t?.legalName ? { legalName: t.legalName } : {}),
    ...(legal.legalForm ? { legalForm: legal.legalForm } : {}),
    ...(legal.taxRegime ? { taxRegime: legal.taxRegime } : {}),
    ...(address ? { address } : {}),
    ...(p.phone ? { phone: p.phone } : {}),
    ...(p.email ? { email: p.email } : {}),
    legalIds: { ...(nif ? { nif } : {}), ...(rccm ? { rccm } : {}) },
  };
}

/** Labels of the guest payment methods (doc 09 §2). */
export const METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  CARD: 'Carte bancaire',
  BANK_TRANSFER: 'Virement bancaire',
  MIXX: 'Mixx by Yas',
  MOOV_MONEY: 'Moov Money',
  CITY_LEDGER: 'Compte débiteur',
  LOYALTY_POINTS: 'Points de fidélité',
};
