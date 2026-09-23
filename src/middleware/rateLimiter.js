import { config } from '../config.js';
import { ERROR_CODES } from '../errors.js';

const buckets = new Map();

function keyForIp(ip) {
  return ip || 'unknown';
}

function prune(now) {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Fixed-window IP rate limiter. Limits are read from config/app.config.json
 * (overridable via RATE_LIMIT_MAX env var), never hardcoded here.
 */
export function rateLimiter(req, res, next) {
  const { windowMs, max, message } = config.rateLimit;
  const now = Date.now();
  const ip = keyForIp(req.ip);
  prune(now);

  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(ip, bucket);
  }

  if (bucket.count >= max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    res.status(429).json({
      error: { code: ERROR_CODES.RATE_LIMITED, message },
    });
    return;
  }

  bucket.count += 1;
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  next();
}

export function resetRateLimiter() {
  buckets.clear();
}
