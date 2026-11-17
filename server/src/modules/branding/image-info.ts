/**
 * Minimal image header parser (PNG, JPEG, WebP, ICO): detects the real format from magic bytes
 * and reads the pixel size without decoding, so no native image library is needed.
 */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/x-icon';

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Buffer, sig: number[]): boolean {
  return sig.every((b, i) => buf[i] === b);
}

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.toString('latin1', start, end);
}

function png(buf: Buffer): ImageInfo | null {
  if (buf.length < 24 || !startsWith(buf, PNG_SIG) || ascii(buf, 12, 16) !== 'IHDR') return null;
  return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpeg(buf: Buffer): ImageInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1] as number;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof)
      return {
        mime: 'image/jpeg',
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function webp(buf: Buffer): ImageInfo | null {
  if (buf.length < 30 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 12) !== 'WEBP') return null;
  const fourcc = ascii(buf, 12, 16);
  if (fourcc === 'VP8 ')
    return {
      mime: 'image/webp',
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X')
    return {
      mime: 'image/webp',
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
    };
  return null;
}

function ico(buf: Buffer): ImageInfo | null {
  if (buf.length < 22 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  if (count < 1) return null;
  let width = 0;
  let height = 0;
  for (let i = 0; i < count && 6 + (i + 1) * 16 <= buf.length; i++) {
    width = Math.max(width, buf[6 + i * 16] || 256);
    height = Math.max(height, buf[7 + i * 16] || 256);
  }
  return { mime: 'image/x-icon', width, height };
}

/** Returns the detected format and size, or null when the bytes are not a supported image. */
export function readImageInfo(buf: Buffer): ImageInfo | null {
  return png(buf) ?? jpeg(buf) ?? webp(buf) ?? ico(buf);
}

/** Does the MIME type declared by the client match the detected format? */
export function declaredMimeMatches(declared: string, detected: ImageMime): boolean {
  if (detected === 'image/x-icon')
    return declared === 'image/x-icon' || declared === 'image/vnd.microsoft.icon';
  return declared === detected;
}

export const EXTENSION: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
};
