import { randomBytes, scrypt, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, salt, hex] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await derive(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function encrypt(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  return [iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()].map(b => b.toString('base64')).join('.');
}
export function decrypt(value, key) {
  const [iv, payload, tail, tag] = value.split('.').map(s => Buffer.from(s, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(payload), cipher.update(tail), cipher.final()]).toString('utf8');
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buffer) {
  let bits = 0, value = 0, out = '';
  for (const b of buffer) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode32(secret) {
  let bits = 0, value = 0; const out = [];
  for (const c of secret.replace(/=+$/, '').toUpperCase()) { const n = alphabet.indexOf(c); if (n < 0) throw new Error('Invalid TOTP secret'); value = (value << 5) | n; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totp(secret, counter) {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', decode32(secret)).update(message).digest();
  return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function verifyTotp(secret, code, previous = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const current = Math.floor(now / 30000);
  for (let offset = -1; offset <= 1; offset++) {
    const counter = current + offset;
    if (counter > previous && timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code))) return counter;
  }
  return null;
}
export function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
}
