/** WCAG 2.1 contrast helpers (server side copy: the server does not depend on @hm/ui). */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA threshold for normal text. */
export const AA_RATIO = 4.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ContrastWarning {
  code:
    | 'PRIMARY_LOW_CONTRAST_WHITE'
    | 'PRIMARY_LOW_CONTRAST_BLACK'
    | 'PRIMARY_NO_READABLE_TEXT'
    | 'SECONDARY_LOW_CONTRAST_WHITE';
  message: string;
  ratio: number;
}

export interface ContrastReport {
  primary: { vsWhite: number; vsBlack: number; onPrimary: '#ffffff' | '#000000' } | null;
  secondary: { vsWhite: number } | null;
  warnings: ContrastWarning[];
}

/**
 * Checks the primary colour against white and black text (and the secondary against white,
 * used as the sidebar / footer background). Never blocks the save: only returns warnings.
 */
export function checkContrast(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): ContrastReport {
  const warnings: ContrastWarning[] = [];
  let p: ContrastReport['primary'] = null;
  let s: ContrastReport['secondary'] = null;

  if (primary) {
    const vsWhite = round2(contrastRatio(primary, '#ffffff'));
    const vsBlack = round2(contrastRatio(primary, '#000000'));
    p = { vsWhite, vsBlack, onPrimary: vsWhite >= vsBlack ? '#ffffff' : '#000000' };
    if (vsWhite < AA_RATIO && vsBlack < AA_RATIO) {
      warnings.push({
        code: 'PRIMARY_NO_READABLE_TEXT',
        message: `Primary colour reaches only ${Math.max(vsWhite, vsBlack)}:1 against both white and black text (WCAG AA needs ${AA_RATIO}:1).`,
        ratio: Math.max(vsWhite, vsBlack),
      });
    } else if (vsWhite < AA_RATIO) {
      warnings.push({
        code: 'PRIMARY_LOW_CONTRAST_WHITE',
        message: `White text on the primary colour is ${vsWhite}:1 (WCAG AA needs ${AA_RATIO}:1); black text will be used.`,
        ratio: vsWhite,
      });
    } else if (vsBlack < AA_RATIO) {
      warnings.push({
        code: 'PRIMARY_LOW_CONTRAST_BLACK',
        message: `Black text on the primary colour is ${vsBlack}:1 (WCAG AA needs ${AA_RATIO}:1); white text will be used.`,
        ratio: vsBlack,
      });
    }
  }
  if (secondary) {
    const vsWhite = round2(contrastRatio(secondary, '#ffffff'));
    s = { vsWhite };
    if (vsWhite < AA_RATIO)
      warnings.push({
        code: 'SECONDARY_LOW_CONTRAST_WHITE',
        message: `White text on the secondary colour is ${vsWhite}:1 (WCAG AA needs ${AA_RATIO}:1).`,
        ratio: vsWhite,
      });
  }
  return { primary: p, secondary: s, warnings };
}
