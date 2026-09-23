import crypto from 'node:crypto';

const NAME_SPACE_URL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function hexToUuid(buffer) {
  const hex = buffer.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Deterministic (RFC 4122 v5 style) UUID derived from a logical key.
 * Used by the seed script so re-running it upserts instead of duplicating.
 */
export function uuidFromKey(key, namespace = NAME_SPACE_URL) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto
    .createHash('sha1')
    .update(ns)
    .update(Buffer.from(key, 'utf8'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return hexToUuid(bytes);
}

export function randomUuid() {
  return crypto.randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
