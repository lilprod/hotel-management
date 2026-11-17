// Converts the downloaded demo photos to responsive WebP files in public/demo/.
// Usage: node scripts/build-demo-images.mjs <source-dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const src = process.argv[2];
if (!src) throw new Error('source directory required');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo');
fs.mkdirSync(out, { recursive: true });

const WIDTHS = [640, 1280, 1920];
// Only the hero needs the 1920 variant; everything else tops out at 1280 to keep the repo light.
const MAX_WIDTH = { hero: 1920 };
const manifest = {};

for (const file of fs.readdirSync(src).filter((f) => f.endsWith('.jpg'))) {
  const name = file.replace('.jpg', '');
  const input = sharp(path.join(src, file));
  const meta = await input.metadata();
  const max = MAX_WIDTH[name] ?? 1280;
  manifest[name] = { ratio: [meta.width, meta.height], widths: [] };
  for (const w of WIDTHS.filter((x) => x <= max && x <= (meta.width ?? 0))) {
    const info = await sharp(path.join(src, file))
      .resize({ width: w })
      .webp({ quality: w >= 1920 ? 62 : 68, effort: 5 })
      .toFile(path.join(out, `${name}-${w}.webp`));
    manifest[name].widths.push([w, info.height, info.size]);
  }
}
console.log(JSON.stringify(manifest));
