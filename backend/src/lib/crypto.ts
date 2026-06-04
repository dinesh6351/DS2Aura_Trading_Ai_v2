import crypto from 'node:crypto';
import { API_KEY_ENC_KEY } from '../config/env.js';

/**
 * AES-256-GCM envelope encryption for exchange API credentials.
 *
 * Each secret is encrypted with a random 12-byte IV and produces an auth tag.
 * We store {cipher, iv, tag} separately (all base64). GCM gives us
 * confidentiality + integrity: a tampered ciphertext fails decryption.
 *
 * Rotation: to rotate API_KEY_ENC_KEY, decrypt-with-old then encrypt-with-new
 * in a migration job (see docs/04-security-checklist.md).
 */
export interface EncryptedField {
  cipher: string; // base64
  iv: string;     // base64
  tag: string;    // base64
}

export function encryptSecret(plaintext: string): EncryptedField {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', API_KEY_ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(field: EncryptedField): string {
  const iv = Buffer.from(field.iv, 'base64');
  const tag = Buffer.from(field.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', API_KEY_ENC_KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([
    decipher.update(Buffer.from(field.cipher, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

/** Constant-time compare to avoid timing side-channels on tokens/hashes. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** SHA-256 of a token (for indexing/lookups where we don't need reversibility). */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** HMAC-SHA256 — used to sign Binance requests. */
export function hmacSha256(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Cryptographically-strong random token (URL-safe). */
export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Mask a key for display: keep first 4 + last 4. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
