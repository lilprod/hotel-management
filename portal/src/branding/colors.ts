import { contrastRatio } from '@hm/ui/core';

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear mix of two `#rrggbb` colors: `t` = 0 gives `a`, `t` = 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/**
 * Moves `color` away from `background` (darker on a light background, lighter on a dark one)
 * until the pair reaches `min` contrast. Keeps the tenant hue, guarantees readable text.
 */
export function readableOn(color: string, background: string, min = 4.5): string {
  if (contrastRatio(color, background) >= min) return color;
  const target =
    contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
      ? '#000000'
      : '#ffffff';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = mixHex(color, target, t);
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return target;
}

/** Page background and dark-section tokens derived from the tenant colors (also mirrored in CSS). */
export const PAPER_BASE = '#f9f8f5';
export const DEEP_BASE = '#0c0e0d';

export interface PortalPalette {
  /** Primary readable as text on the light page background (>= 4.5:1). */
  primaryInk: string;
  /** Deep surface for the testimonials, drawer and footer (primary mixed with near-black). */
  deep: string;
  /** Primary readable as text on `deep`. */
  primaryGlow: string;
  /** Secondary readable as text on `deep`. */
  secondaryGlow: string;
  /** Secondary readable as text on the light page background. */
  secondaryInk: string;
}

export function buildPalette(primary: string, secondary: string): PortalPalette {
  const paper = mixHex(PAPER_BASE, primary, 0.04);
  const deep = mixHex(primary, DEEP_BASE, 0.7);
  return {
    primaryInk: readableOn(primary, paper),
    deep,
    primaryGlow: readableOn(primary, deep),
    secondaryGlow: readableOn(secondary, deep),
    secondaryInk: readableOn(secondary, paper),
  };
}
