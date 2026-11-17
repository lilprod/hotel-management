/**
 * Generic royalty-free demo photos bundled in `public/demo/` (see CREDITS.md there).
 * They are only a fallback: a photo uploaded by the hotel always takes precedence.
 */
export type DemoPhotoKey =
  | 'hero'
  | 'exterior'
  | 'pool'
  | 'lagoon'
  | 'room-classic'
  | 'room-deluxe'
  | 'suite'
  | 'bathroom'
  | 'dish'
  | 'restaurant'
  | 'bar'
  | 'spa'
  | 'snorkel'
  | 'lobby'
  | 'garden';

/** [width, height] of each generated WebP variant (`<key>-<width>.webp`). */
const VARIANTS: Record<DemoPhotoKey, readonly (readonly [number, number])[]> = {
  hero: [
    [640, 426],
    [1280, 853],
    [1920, 1280],
  ],
  exterior: [
    [640, 427],
    [1280, 853],
  ],
  pool: [
    [640, 426],
    [1280, 853],
  ],
  lagoon: [
    [640, 426],
    [1280, 853],
  ],
  'room-classic': [
    [640, 426],
    [1280, 853],
  ],
  'room-deluxe': [
    [640, 456],
    [1280, 913],
  ],
  suite: [
    [640, 426],
    [1280, 853],
  ],
  bathroom: [
    [640, 427],
    [1280, 854],
  ],
  dish: [
    [640, 426],
    [1280, 853],
  ],
  restaurant: [
    [640, 480],
    [1280, 960],
  ],
  bar: [
    [640, 480],
    [1280, 960],
  ],
  spa: [
    [640, 426],
    [1280, 853],
  ],
  snorkel: [
    [640, 426],
    [1280, 853],
  ],
  lobby: [
    [640, 360],
    [1280, 720],
  ],
  garden: [
    [640, 853],
    [1280, 1707],
  ],
};

export interface ResolvedPhoto {
  src: string;
  srcSet?: string;
  /** Intrinsic size hint (aspect ratio) so the browser reserves space: no layout shift. */
  width: number;
  height: number;
  /** True when the bundled demo photo is used, false when the hotel's own photo is. */
  isDemo: boolean;
}

function demoUrl(key: DemoPhotoKey, width: number): string {
  return `${import.meta.env.BASE_URL}demo/${key}-${width}.webp`;
}

/**
 * Picks the photo to display: the hotel's uploaded photo when there is one (room type photo,
 * branding asset), the bundled demo photo otherwise.
 */
export function resolvePhoto(
  uploadedUrl: string | null | undefined,
  demo: DemoPhotoKey,
): ResolvedPhoto {
  const variants = VARIANTS[demo];
  const largest = variants[variants.length - 1] as readonly [number, number];
  if (uploadedUrl) {
    return { src: uploadedUrl, width: largest[0], height: largest[1], isDemo: false };
  }
  const mid = variants[Math.min(1, variants.length - 1)] as readonly [number, number];
  return {
    src: demoUrl(demo, mid[0]),
    srcSet: variants.map(([w]) => `${demoUrl(demo, w)} ${w}w`).join(', '),
    width: largest[0],
    height: largest[1],
    isDemo: true,
  };
}
