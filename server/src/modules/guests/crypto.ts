import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Identity document numbers at rest (`guests.id_doc_number_enc`): AES-256-GCM with a key derived
 * (HKDF) from the server secret. Format `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */
const keys = new Map<string, Buffer>();
function keyOf(secret: string): Buffer {
  let k = keys.get(secret);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', secret, 'hm-guests', 'id-doc-number-v1', 32));
    keys.set(secret, k);
  }
  return k;
}

export function encryptIdNumber(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), enc]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptIdNumber(payload: string, secret: string): string {
  const [v, iv, tag, enc] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unsupported id number format');
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

/** `••••1234`: only the last 4 characters are ever returned by the API. */
export function maskIdNumber(plain: string): string {
  return `••••${plain.slice(-4)}`;
}
