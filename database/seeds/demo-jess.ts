import type { AdminClient } from '../src/index.js';
import { seedId, SEED_CURRENCY, type Logger } from './common.js';
import { demoIds, seedDemoTenant, type DemoTenantSpec } from './demo-common.js';

/**
 * Demo tenant "Jess Hôtel" in Lomé: 30 rooms and a restaurant, MEDIUM plan.
 * Name chosen by the client; addresses, NIF/RCCM, phones and guests are demo placeholders.
 */
export const JESS_SLUG = 'jess-hotel';

export const JESS_SPEC: DemoTenantSpec = {
  slug: JESS_SLUG,
  name: 'Jess Hôtel',
  legalName: 'Jess Hôtel (données de démonstration)',
  planCode: 'MEDIUM',
  city: 'Lomé',
  address: 'Adresse de démonstration, Lomé',
  taxId: 'NIF-DEMO-0000003',
  rccm: 'RCCM-DEMO-LOM-0003',
  primaryColor: '#7C2D12',
  secondaryColor: '#CA8A04',
  businessPhone: '+22822000003',
  guestPhonePrefix: '900002',
  departments: [
    { code: 'HEB', name: 'Hébergement' },
    { code: 'RES', name: 'Restauration' },
    { code: 'HK', name: 'Housekeeping' },
    { code: 'MAINT', name: 'Maintenance' },
  ],
  roomTypes: [
    {
      code: 'STD',
      name: 'Chambre standard',
      description: 'Chambre double standard',
      maxAdults: 2,
      maxChildren: 1,
      baseOccupancy: 2,
      beds: '1 grand lit',
      sizeM2: 20,
      amenities: ['climatisation', 'wifi'],
      count: 20,
      numberPrefix: '',
      numberStart: 101,
      floor: '1',
      basePrice: 22_000,
      seasonPrice: 27_500,
      extraAdult: 5_000,
      extraChild: 2_500,
    },
    {
      code: 'DLX',
      name: 'Chambre deluxe',
      description: 'Chambre deluxe avec coin salon',
      maxAdults: 2,
      maxChildren: 2,
      baseOccupancy: 2,
      beds: '1 très grand lit',
      sizeM2: 28,
      amenities: ['climatisation', 'wifi', 'minibar', 'coin salon'],
      count: 10,
      numberPrefix: '',
      numberStart: 201,
      floor: '2',
      basePrice: 32_000,
      seasonPrice: 40_000,
      extraAdult: 6_000,
      extraChild: 3_000,
    },
  ],
  season: { name: 'Haute saison', from: '2026-12-15', to: '2027-01-15', priority: 10 },
  products: [
    { code: 'WATER', name: 'Eau minérale 1,5 L', price: 1_000, departmentCode: 'RES' },
    { code: 'SODA', name: 'Soda 33 cl', price: 1_000, departmentCode: 'RES' },
    { code: 'LAUNDRY', name: 'Blanchisserie (forfait)', price: 4_500, departmentCode: 'HK' },
  ],
};

const MENU_ITEMS = [
  { key: 'akoume', fr: 'Akoumé sauce gombo', en: 'Akoume with okra sauce', price: 3_500, dietaryTags: [], allergens: [] },
  { key: 'poulet', fr: 'Poulet braisé, alloco', en: 'Grilled chicken with fried plantain', price: 5_000, dietaryTags: ['HALAL'], allergens: [] },
  { key: 'poisson', fr: 'Poisson grillé, attiéké', en: 'Grilled fish with attieke', price: 6_000, dietaryTags: ['GLUTEN_FREE'], allergens: ['FISH'] },
  { key: 'salade', fr: 'Salade de légumes frais', en: 'Fresh vegetable salad', price: 2_500, dietaryTags: ['VEGAN', 'VEGETARIAN'], allergens: [] },
] as const;

export async function seedDemoJess(
  admin: AdminClient,
  options: { demoPassword?: string; log: Logger },
): Promise<{ guests: number; rooms: number; menuItems: number }> {
  const base = await seedDemoTenant(admin, JESS_SPEC, options);
  const { tenantId, propertyId } = base;
  const slug = JESS_SLUG;
  const taxId = demoIds.tax(slug, 'TVA18');

  const restaurantId = seedId(`outlet:${slug}:restaurant`);
  await admin.outlet.upsert({
    where: { id: restaurantId },
    create: {
      id: restaurantId,
      tenantId,
      propertyId,
      departmentId: demoIds.department(slug, 'RES'),
      type: 'RESTAURANT',
      name: 'Restaurant',
      openingHours: { lunch: '12:00-15:00', dinner: '19:00-22:30' },
    },
    update: { name: 'Restaurant' },
  });

  const categoryId = seedId(`menu-category:${slug}:MAINS`);
  const categoryName = { fr: 'Plats', en: 'Mains' };
  await admin.menuCategory.upsert({
    where: { id: categoryId },
    create: { id: categoryId, tenantId, outletId: restaurantId, nameI18n: categoryName, sort: 1 },
    update: { nameI18n: categoryName, sort: 1 },
  });

  for (const item of MENU_ITEMS) {
    const id = seedId(`menu-item:${slug}:${item.key}`);
    const data = {
      categoryId,
      taxId,
      nameI18n: { fr: item.fr, en: item.en },
      currency: SEED_CURRENCY,
      price: BigInt(item.price),
      departmentCode: 'RES',
      dietaryTags: [...item.dietaryTags],
      allergens: [...item.allergens],
      isAvailable: true,
    };
    await admin.menuItem.upsert({
      where: { id },
      create: { id, tenantId, outletId: restaurantId, ...data },
      update: data,
    });
  }

  return {
    guests: base.guestIds.length,
    rooms: JESS_SPEC.roomTypes.reduce((sum, rt) => sum + rt.count, 0),
    menuItems: MENU_ITEMS.length,
  };
}
