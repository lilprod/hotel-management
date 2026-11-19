import { describe, expect, it } from 'vitest';

const fr = import.meta.glob('./locales/fr/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;
const en = import.meta.glob('./locales/en/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

function keys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('i18n parity', () => {
  it('has the same namespaces and keys in FR and EN', () => {
    const name = (p: string) => p.split('/').pop()!;
    const frNames = Object.keys(fr).map(name).sort();
    expect(Object.keys(en).map(name).sort()).toEqual(frNames);
    for (const [path, mod] of Object.entries(fr)) {
      const other = en[path.replace('/fr/', '/en/')]!;
      const strip = (k: string) => k.replace(/_(one|other|zero|few|many)$/, '');
      const a = new Set(keys(mod.default).map(strip));
      const b = new Set(keys(other.default).map(strip));
      expect(
        [...a].filter((k) => !b.has(k)),
        `${path}: missing in EN`,
      ).toEqual([]);
      expect(
        [...b].filter((k) => !a.has(k)),
        `${path}: missing in FR`,
      ).toEqual([]);
    }
  });
});
