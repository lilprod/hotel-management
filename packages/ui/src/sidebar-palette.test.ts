import { describe, expect, it } from 'vitest';

import { buildThemeConfig, contrastRatio, relativeLuminance, sidebarPalette } from './index';

const PALETTES = [
  { primaryColor: '#0F766E', secondaryColor: '#F59E0B' },
  { primaryColor: '#7C2D12', secondaryColor: '#CA8A04' },
  { primaryColor: '#3F6212', secondaryColor: '#B45309' },
].map((p) => ({ ...p, logoUrl: null, name: 'Demo' }));

describe('sidebarPalette', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const branding of PALETTES) {
      it(`${mode} ${branding.primaryColor}: text is AA on a dark background`, () => {
        const p = sidebarPalette(branding, mode);
        expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
        expect(relativeLuminance(p.background)).toBeLessThan(0.05);
        expect(p.background.toLowerCase()).not.toBe(branding.secondaryColor.toLowerCase());
        expect(contrastRatio(p.selectedText, p.selectedBg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.selectedBg, p.background)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(p.accent, p.background)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('feeds the antd Layout and Menu tokens', () => {
    const [branding] = PALETTES;
    const p = sidebarPalette(branding!, 'light');
    const cfg = buildThemeConfig(branding!, 'light');
    expect(cfg.components?.Layout?.siderBg).toBe(p.background);
    expect(cfg.components?.Menu?.darkItemColor).toBe(p.text);
    expect(cfg.components?.Menu?.darkItemSelectedBg).toBe(p.selectedBg);
  });
});
