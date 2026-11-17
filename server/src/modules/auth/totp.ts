import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;

/** RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits) for a time step. */
export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return bin.toString().padStart(TOTP_DIGITS, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_PERIOD_S);

export function generateTotp(secretB32: string, now = Date.now()): string {
  return totpAt(secretB32, currentStep(now));
}

/** Returns the matched time step (window ±1) or null. */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    const expected = Buffer.from(totpAt(secretB32, s));
    if (timingSafeEqual(expected, Buffer.from(code))) return s;
  }
  return null;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(opts: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Secret encryption at rest (AES-256-GCM, key derived with HKDF from the server secret)
// ---------------------------------------------------------------------------

const keyCache = new Map<string, Buffer>();
function keyOf(serverSecret: string): Buffer {
  let k = keyCache.get(serverSecret);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', serverSecret, 'hm-mfa', 'totp-secret-v1', 32));
    keyCache.set(serverSecret, k);
  }
  return k;
}

/** `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plain: string, serverSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(serverSecret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, enc]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(payload: string, serverSecret: string): string {
  const [v, iv, tag, enc] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyOf(serverSecret),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Backup codes (10 single-use codes, stored hashed)
// ---------------------------------------------------------------------------

export const BACKUP_CODE_COUNT = 10;

export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function hashBackupCode(code: string): string {
  return createHash('sha256')
    .update(`hm-backup:${normalizeBackupCode(code)}`)
    .digest('hex');
}

/** `XXXXX-XXXXX` (base32, 50 bits each). */
export function generateBackupCodes(n = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const looksLikeBackupCode = (code: string) =>
  /^[A-Z2-7]{10}$/.test(normalizeBackupCode(code));
