import type { AdminClient } from '../src/index.js';
import type { Logger } from './common.js';
import { seedDemoTenant, type DemoTenantSpec } from './demo-common.js';

/**
 * Fictional demo hotel in Kpalimé: 20 rooms, STANDARD plan. Name and identifiers are invented.
 */
export const KPALIME_SLUG = 'collines-vertes';

export const KPALIME_SPEC: DemoTenantSpec = {
  slug: KPALIME_SLUG,
  name: 'Hôtel Collines Vertes',
  legalName: 'Hôtel Collines Vertes (données fictives de démonstration)',
  planCode: 'STANDARD',
  city: 'Kpalimé',
  address: 'Route des collines (adresse fictive), Kpalimé',
  taxId: 'NIF-FICTIF-0000002',
  rccm: 'RCCM-FICTIF-KPA-0002',
  primaryColor: '#3F6212',
  secondaryColor: '#B45309',
  businessPhone: '+22822000002',
  guestPhonePrefix: '900001',
  departments: [
    { code: 'HEB', name: 'Hébergement' },
    { code: 'RES', name: 'Restauration' },
    { code: 'HK', name: 'Housekeeping' },
    { code: 'MAINT', name: 'Maintenance' },
  ],
  roomTypes: [
    {
      code: 'DBL',
      name: 'Chambre double',
      description: 'Chambre double avec balcon',
      maxAdults: 2,
      maxChildren: 1,
      baseOccupancy: 2,
      beds: '1 grand lit',
      sizeM2: 18,
      amenities: ['climatisation', 'wifi'],
      count: 14,
      numberPrefix: '',
      numberStart: 101,
      floor: '1',
      basePrice: 18_000,
      seasonPrice: 22_500,
      extraAdult: 4_000,
      extraChild: 2_000,
    },
    {
      code: 'FAM',
      name: 'Chambre familiale',
      description: 'Chambre familiale avec deux lits',
      maxAdults: 4,
      maxChildren: 2,
      baseOccupancy: 2,
      beds: '1 grand lit + 2 lits simples',
      sizeM2: 28,
      amenities: ['climatisation', 'wifi', 'balcon'],
      count: 6,
      numberPrefix: '',
      numberStart: 201,
      floor: '2',
      basePrice: 24_000,
      seasonPrice: 30_000,
      extraAdult: 5_000,
      extraChild: 2_500,
    },
  ],
  season: { name: 'Haute saison', from: '2026-12-20', to: '2027-01-10', priority: 10 },
  products: [
    { code: 'WATER', name: 'Eau minérale 1,5 L', price: 1_000, departmentCode: 'RES' },
    { code: 'JUICE', name: 'Jus de fruits local 25 cl', price: 1_500, departmentCode: 'RES' },
    { code: 'LAUNDRY', name: 'Blanchisserie (forfait)', price: 4_000, departmentCode: 'HK' },
  ],
};

export async function seedDemoKpalime(
  admin: AdminClient,
  options: { demoPassword?: string; log: Logger },
): Promise<{ guests: number; rooms: number }> {
  const base = await seedDemoTenant(admin, KPALIME_SPEC, options);
  return {
    guests: base.guestIds.length,
    rooms: KPALIME_SPEC.roomTypes.reduce((sum, rt) => sum + rt.count, 0),
  };
}
