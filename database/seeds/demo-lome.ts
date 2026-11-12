import type { AdminClient } from '../src/index.js';
import { seedId, SEED_CURRENCY, type Logger } from './common.js';
import { demoIds, seedDemoTenant, type DemoTenantSpec } from './demo-common.js';

/**
 * Fictional demo tenant in Lomé: 60 units, restaurant, bar, spa and activities, PREMIUM plan.
 * The name and every identifier are invented.
 */
export const LOME_SLUG = 'lagune-bleue';

export const LOME_SPEC: DemoTenantSpec = {
  slug: LOME_SLUG,
  name: 'Résidence Lagune Bleue',
  legalName: 'Résidence Lagune Bleue (données fictives de démonstration)',
  planCode: 'PREMIUM',
  city: 'Lomé',
  address: 'Boulevard de la Lagune (adresse fictive), Lomé',
  taxId: 'NIF-FICTIF-0000001',
  rccm: 'RCCM-FICTIF-LOM-0001',
  primaryColor: '#0F766E',
  secondaryColor: '#F59E0B',
  businessPhone: '+22822000001',
  guestPhonePrefix: '900000',
  departments: [
    { code: 'HEB', name: 'Hébergement' },
    { code: 'RES', name: 'Restauration et bar' },
    { code: 'SPA', name: 'Spa' },
    { code: 'ACT', name: 'Activités' },
    { code: 'HK', name: 'Housekeeping' },
    { code: 'MAINT', name: 'Maintenance' },
  ],
  roomTypes: [
    {
      code: 'STD',
      name: 'Standard double',
      description: 'Chambre double standard avec terrasse',
      maxAdults: 2,
      maxChildren: 1,
      baseOccupancy: 2,
      beds: '1 grand lit',
      sizeM2: 22,
      amenities: ['climatisation', 'wifi', 'terrasse'],
      count: 30,
      numberPrefix: '',
      numberStart: 101,
      floor: '1',
      basePrice: 25_000,
      seasonPrice: 31_250,
      extraAdult: 5_000,
      extraChild: 2_500,
    },
    {
      code: 'SUP',
      name: 'Supérieure vue lagune',
      description: 'Chambre supérieure avec vue sur la lagune',
      maxAdults: 2,
      maxChildren: 1,
      baseOccupancy: 2,
      beds: '1 grand lit',
      sizeM2: 30,
      amenities: ['climatisation', 'wifi', 'vue lagune', 'minibar'],
      count: 15,
      numberPrefix: '',
      numberStart: 201,
      floor: '2',
      basePrice: 35_000,
      seasonPrice: 43_750,
      extraAdult: 6_000,
      extraChild: 3_000,
    },
    {
      code: 'BUN',
      name: 'Bungalow',
      description: 'Bungalow indépendant en bord de lagune',
      maxAdults: 3,
      maxChildren: 2,
      baseOccupancy: 2,
      beds: '1 grand lit + canapé-lit',
      sizeM2: 45,
      amenities: ['climatisation', 'wifi', 'terrasse privée', 'kitchenette'],
      count: 10,
      numberPrefix: 'B',
      numberStart: 1,
      floor: 'Bungalows',
      basePrice: 45_000,
      seasonPrice: 56_250,
      extraAdult: 7_000,
      extraChild: 3_500,
    },
    {
      code: 'SUI',
      name: 'Suite',
      description: 'Suite avec salon séparé',
      maxAdults: 3,
      maxChildren: 2,
      baseOccupancy: 2,
      beds: '1 très grand lit',
      sizeM2: 55,
      amenities: ['climatisation', 'wifi', 'salon', 'vue lagune', 'minibar'],
      count: 5,
      numberPrefix: '',
      numberStart: 301,
      floor: '3',
      basePrice: 65_000,
      seasonPrice: 81_250,
      extraAdult: 8_000,
      extraChild: 4_000,
    },
  ],
  season: { name: 'Haute saison', from: '2026-12-15', to: '2027-01-15', priority: 10 },
  products: [
    { code: 'WATER', name: 'Eau minérale 1,5 L', price: 1_000, departmentCode: 'RES' },
    { code: 'BEER', name: 'Bière locale 65 cl', price: 1_500, departmentCode: 'RES' },
    { code: 'SODA', name: 'Soda 33 cl', price: 1_000, departmentCode: 'RES' },
    { code: 'LAUNDRY', name: 'Blanchisserie (forfait)', price: 5_000, departmentCode: 'HK' },
  ],
};

interface LomeMenuItem {
  key: string;
  category: 'STARTERS' | 'MAINS' | 'DESSERTS';
  fr: string;
  en: string;
  price: number;
  dietaryTags: string[];
  allergens: string[];
}

const MENU_CATEGORIES = [
  { key: 'STARTERS', fr: 'Entrées', en: 'Starters', sort: 1 },
  { key: 'MAINS', fr: 'Plats', en: 'Mains', sort: 2 },
  { key: 'DESSERTS', fr: 'Desserts', en: 'Desserts', sort: 3 },
] as const;

const MENU_ITEMS: LomeMenuItem[] = [
  {
    key: 'salad',
    category: 'STARTERS',
    fr: 'Salade fraîcheur du jardin',
    en: 'Garden fresh salad',
    price: 3_500,
    dietaryTags: ['VEGAN', 'GLUTEN_FREE'],
    allergens: [],
  },
  {
    key: 'soup',
    category: 'STARTERS',
    fr: 'Soupe de légumes au gingembre',
    en: 'Ginger vegetable soup',
    price: 3_000,
    dietaryTags: ['VEGETARIAN'],
    allergens: ['CELERY'],
  },
  {
    key: 'prawns',
    category: 'STARTERS',
    fr: 'Crevettes sautées à l’ail',
    en: 'Garlic sautéed prawns',
    price: 5_500,
    dietaryTags: ['HALAL'],
    allergens: ['CRUSTACEANS'],
  },
  {
    key: 'fish',
    category: 'MAINS',
    fr: 'Poisson braisé du lac, attiéké',
    en: 'Grilled lake fish, attieke',
    price: 9_000,
    dietaryTags: ['GLUTEN_FREE', 'HALAL'],
    allergens: ['FISH'],
  },
  {
    key: 'yassa',
    category: 'MAINS',
    fr: 'Poulet yassa',
    en: 'Chicken yassa',
    price: 8_500,
    dietaryTags: ['HALAL'],
    allergens: ['MUSTARD'],
  },
  {
    key: 'peanut',
    category: 'MAINS',
    fr: 'Riz sauce arachide végétarienne',
    en: 'Vegetarian peanut sauce rice',
    price: 6_500,
    dietaryTags: ['VEGAN', 'GLUTEN_FREE'],
    allergens: ['PEANUTS'],
  },
  {
    key: 'skewers',
    category: 'MAINS',
    fr: 'Brochettes de bœuf',
    en: 'Beef skewers',
    price: 7_500,
    dietaryTags: ['HALAL'],
    allergens: [],
  },
  {
    key: 'pineapple',
    category: 'DESSERTS',
    fr: 'Ananas frais',
    en: 'Fresh pineapple',
    price: 2_500,
    dietaryTags: ['VEGAN', 'GLUTEN_FREE'],
    allergens: [],
  },
  {
    key: 'mousse',
    category: 'DESSERTS',
    fr: 'Mousse au chocolat',
    en: 'Chocolate mousse',
    price: 3_000,
    dietaryTags: ['VEGETARIAN'],
    allergens: ['EGGS', 'MILK'],
  },
  {
    key: 'banana',
    category: 'DESSERTS',
    fr: 'Beignets de banane',
    en: 'Banana fritters',
    price: 2_000,
    dietaryTags: ['VEGAN'],
    allergens: ['GLUTEN'],
  },
];

const SPA_SERVICES = [
  {
    key: 'relax',
    fr: 'Massage relaxant 60 min',
    en: 'Relaxing massage 60 min',
    category: 'MASSAGE',
    durationMin: 60,
    price: 25_000,
  },
  {
    key: 'stones',
    fr: 'Massage aux pierres chaudes 90 min',
    en: 'Hot stone massage 90 min',
    category: 'MASSAGE',
    durationMin: 90,
    price: 35_000,
  },
  {
    key: 'face',
    fr: 'Soin visage éclat 45 min',
    en: 'Radiance facial 45 min',
    category: 'FACIAL',
    durationMin: 45,
    price: 20_000,
  },
  {
    key: 'ritual',
    fr: 'Rituel hammam à l’argile 75 min',
    en: 'Clay hammam ritual 75 min',
    category: 'RITUAL',
    durationMin: 75,
    price: 30_000,
  },
];

const LAGOON_ACTIVITY = {
  key: 'pirogue',
  fr: 'Balade en pirogue sur la lagune',
  en: 'Pirogue trip on the lagoon',
  pricePerPerson: 15_000,
  capacity: 8,
  durationMin: 120,
};

export async function seedDemoLome(
  admin: AdminClient,
  options: { demoPassword?: string; log: Logger },
): Promise<{
  guests: number;
  rooms: number;
  menuItems: number;
  spaServices: number;
  slots: number;
}> {
  const base = await seedDemoTenant(admin, LOME_SPEC, options);
  const { tenantId, propertyId } = base;
  const slug = LOME_SLUG;
  const taxId = demoIds.tax(slug, 'TVA18');
  const restaurantDept = demoIds.department(slug, 'RES');

  // Outlets.
  const restaurantId = seedId(`outlet:${slug}:restaurant`);
  await admin.outlet.upsert({
    where: { id: restaurantId },
    create: {
      id: restaurantId,
      tenantId,
      propertyId,
      departmentId: restaurantDept,
      type: 'RESTAURANT',
      name: 'Restaurant La Lagune (fictif)',
      openingHours: { lunch: '12:00-15:00', dinner: '19:00-22:30' },
    },
    update: { name: 'Restaurant La Lagune (fictif)' },
  });
  const barId = seedId(`outlet:${slug}:bar`);
  await admin.outlet.upsert({
    where: { id: barId },
    create: {
      id: barId,
      tenantId,
      propertyId,
      departmentId: restaurantDept,
      type: 'BAR',
      name: 'Bar du Ponton (fictif)',
      openingHours: { daily: '10:00-23:00' },
    },
    update: { name: 'Bar du Ponton (fictif)' },
  });

  // Menu: 3 categories, 10 items with dietary tags.
  const categoryIds = new Map<string, string>();
  for (const cat of MENU_CATEGORIES) {
    const id = seedId(`menu-category:${slug}:${cat.key}`);
    categoryIds.set(cat.key, id);
    const nameI18n = { fr: cat.fr, en: cat.en };
    await admin.menuCategory.upsert({
      where: { id },
      create: { id, tenantId, outletId: restaurantId, nameI18n, sort: cat.sort },
      update: { nameI18n, sort: cat.sort },
    });
  }
  for (const item of MENU_ITEMS) {
    const id = seedId(`menu-item:${slug}:${item.key}`);
    const nameI18n = { fr: item.fr, en: item.en };
    const data = {
      categoryId: categoryIds.get(item.category),
      taxId,
      nameI18n,
      currency: SEED_CURRENCY,
      price: BigInt(item.price),
      departmentCode: 'RES',
      dietaryTags: item.dietaryTags,
      allergens: item.allergens,
      isAvailable: true,
    };
    await admin.menuItem.upsert({
      where: { id },
      create: { id, tenantId, outletId: restaurantId, ...data },
      update: data,
    });
  }

  // Spa: services and two treatment rooms.
  for (const svc of SPA_SERVICES) {
    const id = seedId(`spa-service:${slug}:${svc.key}`);
    const nameI18n = { fr: svc.fr, en: svc.en };
    const data = {
      taxId,
      nameI18n,
      category: svc.category,
      durationMin: svc.durationMin,
      bufferMin: 15,
      currency: SEED_CURRENCY,
      price: BigInt(svc.price),
      isActive: true,
    };
    await admin.spaService.upsert({
      where: { id },
      create: { id, tenantId, propertyId, ...data },
      update: data,
    });
  }
  const treatmentRooms = [
    { key: 'baobab', name: 'Cabine Baobab (fictive)', capabilities: ['MASSAGE'] },
    { key: 'lagune', name: 'Cabine Lagune (fictive)', capabilities: ['MASSAGE', 'FACIAL'] },
  ];
  for (const room of treatmentRooms) {
    const id = seedId(`treatment-room:${slug}:${room.key}`);
    await admin.treatmentRoom.upsert({
      where: { id },
      create: { id, tenantId, propertyId, name: room.name, capabilities: room.capabilities },
      update: { name: room.name, capabilities: room.capabilities },
    });
  }

  // Activity with three bookable slots (times are UTC; Africa/Lome is UTC+0).
  const activityId = seedId(`activity:${slug}:${LAGOON_ACTIVITY.key}`);
  const activityData = {
    nameI18n: { fr: LAGOON_ACTIVITY.fr, en: LAGOON_ACTIVITY.en },
    currency: SEED_CURRENCY,
    pricePerPerson: BigInt(LAGOON_ACTIVITY.pricePerPerson),
    capacity: LAGOON_ACTIVITY.capacity,
    durationMin: LAGOON_ACTIVITY.durationMin,
    isActive: true,
  };
  await admin.activity.upsert({
    where: { id: activityId },
    create: { id: activityId, tenantId, propertyId, ...activityData },
    update: activityData,
  });
  const slotStarts = ['2026-12-05T08:00:00Z', '2026-12-06T08:00:00Z', '2026-12-07T15:00:00Z'];
  for (const [index, start] of slotStarts.entries()) {
    const startAt = new Date(start);
    const endAt = new Date(startAt.getTime() + LAGOON_ACTIVITY.durationMin * 60_000);
    const id = seedId(`activity-slot:${slug}:${index + 1}`);
    await admin.activitySlot.upsert({
      where: { id },
      create: {
        id,
        tenantId,
        activityId,
        startAt,
        endAt,
        capacity: LAGOON_ACTIVITY.capacity,
        booked: 0,
      },
      update: { startAt, endAt, capacity: LAGOON_ACTIVITY.capacity },
    });
  }

  options.log(
    `${slug}: 2 outlets, ${MENU_CATEGORIES.length} menu categories, ${MENU_ITEMS.length} menu items, ${SPA_SERVICES.length} spa services, ${treatmentRooms.length} treatment rooms, 1 activity with ${slotStarts.length} slots`,
  );

  return {
    guests: base.guestIds.length,
    rooms: LOME_SPEC.roomTypes.reduce((sum, rt) => sum + rt.count, 0),
    menuItems: MENU_ITEMS.length,
    spaServices: SPA_SERVICES.length,
    slots: slotStarts.length,
  };
}
