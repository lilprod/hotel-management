/**
 * DEMO CONTENT. Everything in this file is placeholder marketing content shown by the public
 * portal until the hotel's own catalogue is exposed by the portal API (room types, spa,
 * restaurant, activities, reviews). Prices, quotes and names are fictional.
 *
 * Hotel-owned data always wins: `photoUrl` on an item (e.g. a room type photo from the API)
 * takes precedence over the bundled demo photo, and contact details come from the branding.
 */
import type { IconName } from './components/Icon';
import type { DemoPhotoKey } from './media/photos';

export interface Localized {
  fr: string;
  en: string;
}

export type SectionId = 'accommodations' | 'spa' | 'restaurant' | 'activities';

export interface DemoAccommodation {
  id: string;
  name: Localized;
  blurb: Localized;
  /** Nightly rate in XOF (integer, no decimals). */
  priceFrom: number;
  currency: 'XOF';
  sleeps: number;
  surface: number;
  amenities: IconName[];
  photo: DemoPhotoKey;
  /** Photo uploaded by the hotel for this room type; overrides `photo` when set. */
  photoUrl?: string | null;
}

export const demoAccommodations: DemoAccommodation[] = [
  {
    id: 'classic',
    name: { fr: 'Chambre Classique', en: 'Classic Room' },
    blurb: {
      fr: 'Un lit confortable, une literie soignée et la lumière du matin sur le jardin.',
      en: 'A comfortable bed, fine linen and morning light over the garden.',
    },
    priceFrom: 45000,
    currency: 'XOF',
    sleeps: 2,
    surface: 24,
    amenities: ['ac', 'wifi', 'tv', 'coffee'],
    photo: 'room-classic',
  },
  {
    id: 'deluxe',
    name: { fr: 'Chambre Deluxe', en: 'Deluxe Room' },
    blurb: {
      fr: 'Plus d’espace, des portes-fenêtres ouvertes sur la terrasse et une salle de bain avec baignoire.',
      en: 'More space, French doors opening onto the terrace and a bathroom with a tub.',
    },
    priceFrom: 65000,
    currency: 'XOF',
    sleeps: 3,
    surface: 34,
    amenities: ['ac', 'wifi', 'balcony', 'bath'],
    photo: 'room-deluxe',
  },
  {
    id: 'suite',
    name: { fr: 'Suite Lagune', en: 'Lagoon Suite' },
    blurb: {
      fr: 'Une grande pièce à vivre, un coin salon et un accès direct à la piscine.',
      en: 'A generous living space, a lounge corner and direct access to the pool.',
    },
    priceFrom: 120000,
    currency: 'XOF',
    sleeps: 4,
    surface: 58,
    amenities: ['ac', 'wifi', 'pool', 'bath'],
    photo: 'suite',
  },
];

export interface DemoOffer {
  name: Localized;
  desc: Localized;
  /** Price in XOF; omitted when the offer is free or on request. */
  price?: number;
  duration?: Localized;
}

export interface DemoSection {
  id: Exclude<SectionId, 'accommodations'>;
  photo: DemoPhotoKey;
  /** Secondary photo shown in the home page section. */
  photoUrl?: string | null;
  offers: DemoOffer[];
}

export const demoSections: Record<DemoSection['id'], DemoSection> = {
  spa: {
    id: 'spa',
    photo: 'spa',
    offers: [
      {
        name: { fr: 'Massage signature', en: 'Signature massage' },
        desc: {
          fr: 'Huiles tièdes et gestes lents pour dénouer les tensions du voyage.',
          en: 'Warm oils and slow strokes to ease the strain of travel.',
        },
        price: 30000,
        duration: { fr: '60 min', en: '60 min' },
      },
      {
        name: { fr: 'Gommage et enveloppement', en: 'Scrub and wrap' },
        desc: {
          fr: 'Un gommage doux suivi d’un enveloppement hydratant au karité.',
          en: 'A gentle scrub followed by a moisturising shea wrap.',
        },
        price: 35000,
        duration: { fr: '75 min', en: '75 min' },
      },
      {
        name: { fr: 'Rituel à deux', en: 'Ritual for two' },
        desc: {
          fr: 'Deux soins côte à côte, suivis d’une tisane au jardin.',
          en: 'Two treatments side by side, followed by herbal tea in the garden.',
        },
        price: 60000,
        duration: { fr: '90 min', en: '90 min' },
      },
    ],
  },
  restaurant: {
    id: 'restaurant',
    photo: 'restaurant',
    offers: [
      {
        name: { fr: 'Poisson du jour grillé', en: 'Grilled catch of the day' },
        desc: {
          fr: 'Servi avec attiéké, tomates fraîches et piment à part.',
          en: 'Served with attiéké, fresh tomatoes and chilli on the side.',
        },
        price: 9500,
      },
      {
        name: { fr: 'Salade de mangue et crevettes', en: 'Mango and prawn salad' },
        desc: {
          fr: 'Mangue verte, crevettes sautées, citron vert et coriandre.',
          en: 'Green mango, sautéed prawns, lime and coriander.',
        },
        price: 7500,
      },
      {
        name: { fr: 'Petit déjeuner du jardin', en: 'Garden breakfast' },
        desc: {
          fr: 'Fruits de saison, viennoiseries, œufs à la demande, jus pressés.',
          en: 'Seasonal fruit, pastries, eggs to order, pressed juices.',
        },
        price: 6000,
      },
    ],
  },
  activities: {
    id: 'activities',
    photo: 'snorkel',
    offers: [
      {
        name: { fr: 'Sortie en pirogue', en: 'Canoe outing' },
        desc: {
          fr: 'Une heure sur l’eau calme, au lever ou au coucher du soleil.',
          en: 'An hour on calm water, at sunrise or sunset.',
        },
        price: 15000,
        duration: { fr: '1 h', en: '1 h' },
      },
      {
        name: { fr: 'Initiation au snorkeling', en: 'Snorkeling introduction' },
        desc: {
          fr: 'Masque, tuba et encadrement pour découvrir les poissons du récif.',
          en: 'Mask, snorkel and guide to meet the fish of the reef.',
        },
        price: 20000,
        duration: { fr: '2 h', en: '2 h' },
      },
      {
        name: { fr: 'Balade dans le jardin tropical', en: 'Tropical garden walk' },
        desc: {
          fr: 'Une visite guidée des plantes, des fruits et des oiseaux du domaine.',
          en: 'A guided tour of the estate’s plants, fruit trees and birds.',
        },
        duration: { fr: '45 min', en: '45 min' },
      },
    ],
  },
};

export const demoHighlights: { icon: IconName; key: string }[] = [
  { icon: 'pool', key: 'pool' },
  { icon: 'wifi', key: 'wifi' },
  { icon: 'shuttle', key: 'shuttle' },
  { icon: 'restaurant', key: 'restaurant' },
  { icon: 'spa', key: 'spa' },
];

export interface DemoTestimonial {
  id: string;
  quote: Localized;
  author: string;
  origin: Localized;
  stay: Localized;
}

export const demoTestimonials: DemoTestimonial[] = [
  {
    id: 't1',
    quote: {
      fr: 'Un calme rare. Nous avons déjeuné face à l’eau, puis nous n’avons plus voulu partir de la piscine.',
      en: 'A rare calm. We had lunch facing the water and then never wanted to leave the pool.',
    },
    author: 'Aïcha K.',
    origin: { fr: 'Abidjan', en: 'Abidjan' },
    stay: { fr: 'Séjour de 3 nuits en couple', en: '3 nights as a couple' },
  },
  {
    id: 't2',
    quote: {
      fr: 'Le personnel a pensé à tout, jusqu’au thé servi sur la terrasse à notre arrivée. La chambre était impeccable.',
      en: 'The staff thought of everything, down to the tea served on the terrace when we arrived. The room was spotless.',
    },
    author: 'Marc D.',
    origin: { fr: 'Paris', en: 'Paris' },
    stay: { fr: 'Déplacement professionnel', en: 'Business trip' },
  },
  {
    id: 't3',
    quote: {
      fr: 'Le massage, le poisson grillé, la sortie en pirogue : une semaine de vacances en trois jours.',
      en: 'The massage, the grilled fish, the canoe outing: a week of holiday in three days.',
    },
    author: 'Kofi A.',
    origin: { fr: 'Accra', en: 'Accra' },
    stay: { fr: 'Week-end en famille', en: 'Family weekend' },
  },
];

/** Used when the branding API does not provide an address. */
export const demoAddress: Localized = {
  fr: 'Boulevard de la Marina, bord de lagune',
  en: 'Marina Boulevard, lagoon shore',
};

export const demoHours: Localized = {
  fr: 'Réception ouverte 24 h/24',
  en: 'Front desk open 24/7',
};

/** Gallery photos (with alt text) shown on each section page. */
export interface DemoGalleryItem {
  photo: DemoPhotoKey;
  alt: Localized;
}

export const demoGalleries: Record<SectionId, DemoGalleryItem[]> = {
  accommodations: [
    {
      photo: 'room-classic',
      alt: { fr: 'Chambre classique avec lit double', en: 'Classic room with double bed' },
    },
    {
      photo: 'room-deluxe',
      alt: { fr: 'Chambre deluxe et portes-fenêtres', en: 'Deluxe room with French doors' },
    },
    {
      photo: 'suite',
      alt: { fr: 'Suite ouverte avec salle de bain vitrée', en: 'Open suite with glass bathroom' },
    },
    { photo: 'bathroom', alt: { fr: 'Salle de bain avec baignoire', en: 'Bathroom with bathtub' } },
    { photo: 'lobby', alt: { fr: 'Hall et salon de l’hôtel', en: 'Hotel lobby and lounge' } },
    {
      photo: 'exterior',
      alt: { fr: 'Façade de l’hôtel et palmiers', en: 'Hotel facade and palm trees' },
    },
  ],
  spa: [
    {
      photo: 'spa',
      alt: { fr: 'Serviette, bougie et fleurs du spa', en: 'Spa towel, candle and flowers' },
    },
    {
      photo: 'bathroom',
      alt: { fr: 'Baignoire de la salle de soins', en: 'Treatment room bathtub' },
    },
    { photo: 'garden', alt: { fr: 'Patio tropical du spa', en: 'Tropical spa patio' } },
    { photo: 'pool', alt: { fr: 'Piscine au crépuscule', en: 'Pool at dusk' } },
    {
      photo: 'suite',
      alt: { fr: 'Suite ouverte, ambiance calme', en: 'Open suite, calm atmosphere' },
    },
    { photo: 'lagoon', alt: { fr: 'Plage et palmier', en: 'Beach and palm tree' } },
  ],
  restaurant: [
    {
      photo: 'dish',
      alt: { fr: 'Plats de la carte vus de dessus', en: 'Dishes from the menu, seen from above' },
    },
    {
      photo: 'restaurant',
      alt: { fr: 'Terrasse du restaurant en bord de mer', en: 'Seaside restaurant terrace' },
    },
    { photo: 'bar', alt: { fr: 'Le bar', en: 'The bar' } },
    { photo: 'garden', alt: { fr: 'Patio végétal', en: 'Green patio' } },
    { photo: 'pool', alt: { fr: 'Piscine au crépuscule', en: 'Pool at dusk' } },
    { photo: 'lobby', alt: { fr: 'Hall et salon', en: 'Lobby and lounge' } },
  ],
  activities: [
    {
      photo: 'snorkel',
      alt: { fr: 'Banc de poissons vu en snorkeling', en: 'School of fish seen while snorkeling' },
    },
    { photo: 'lagoon', alt: { fr: 'Plage et palmier', en: 'Beach and palm tree' } },
    { photo: 'garden', alt: { fr: 'Jardin tropical', en: 'Tropical garden' } },
    {
      photo: 'hero',
      alt: { fr: 'Piscine tropicale et bungalows', en: 'Tropical pool and bungalows' },
    },
    { photo: 'pool', alt: { fr: 'Piscine au crépuscule', en: 'Pool at dusk' } },
    {
      photo: 'exterior',
      alt: { fr: 'Façade de l’hôtel et palmiers', en: 'Hotel facade and palm trees' },
    },
  ],
};

export function pick(value: Localized, language: string): string {
  return language === 'en' ? value.en : value.fr;
}
