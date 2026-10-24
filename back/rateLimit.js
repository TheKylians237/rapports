'use strict';

const crypto = require('crypto');
const buckets = new Map();

function normalizeWindow(value) {
  const windowMs = Number(value);
  return Number.isFinite(windowMs) && windowMs > 0
    ? Math.min(Math.floor(windowMs), 24 * 60 * 60 * 1000)
    : 15 * 60 * 1000;
}

function normalizeMax(value) {
  const max = Number(value);
  return Number.isFinite(max) && max > 0 ? Math.min(Math.floor(max), 100000) : 10;
}

function consumeMemory(key, { windowMs, max, now = Date.now() }) {
  const current = buckets.get(key);
  if (!current || current.expiresAt <= now) {
    const next = { count: 1, expiresAt: now + windowMs };
    buckets.set(key, next);
    if (buckets.size > 5000) {
      for (const [entry, value] of buckets) {
        if (value.expiresAt <= now) buckets.delete(entry);
        if (buckets.size <= 4000) break;
      }
    }
    if (buckets.size > 10000) while (buckets.size > 9000) buckets.delete(buckets.keys().next().value);
    return { allowed: true, count: next.count, remaining: Math.max(0, max - next.count), resetAt: next.expiresAt };
  }
  current.count += 1;
  return {
    allowed: current.count <= max,
    count: current.count,
    remaining: Math.max(0, max - current.count),
    resetAt: current.expiresAt,
  };
}

function createMemoryRateLimitStore() {
  return {
    consume(key, options) {
      return consumeMemory(key, options);
    },
    clear() {
      buckets.clear();
    },
  };
}

/** Store partagé MySQL : l'upsert est atomique entre processus. */
function createMysqlRateLimitStore(database) {
  if (!database || typeof database.query !== 'function') throw new TypeError('Un pool de base de données est requis.');
  return {
    async consume(key, { windowMs, max }) {
      const expiresAt = new Date(Date.now() + windowMs);
      await database.query(
        `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, count, expires_at)
         VALUES (?, NOW(), 1, ?)
         ON DUPLICATE KEY UPDATE
           count = IF(expires_at <= NOW(), 1, count + 1),
           window_started_at = IF(expires_at <= NOW(), NOW(), window_started_at),
           expires_at = IF(expires_at <= NOW(), VALUES(expires_at), expires_at)`,
        [key, expiresAt],
      );
      const [rows] = await database.query(
        'SELECT count, expires_at AS expiresAt FROM rate_limit_buckets WHERE bucket_key = ? LIMIT 1',
        [key],
      );
      const row = rows[0] || { count: max + 1, expiresAt };
      const count = Number(row.count || 0);
      const resetAt = new Date(row.expiresAt).getTime() || expiresAt.getTime();
      return { allowed: count <= max, count, remaining: Math.max(0, max - count), resetAt };
    },
  };
}

function keyForRequest(req, keyBy, scope) {
  const identity =
    typeof keyBy === 'function'
      ? String(keyBy(req) || '')
          .trim()
          .toLowerCase()
          .slice(0, 120)
      : '';
  const identityKey = identity ? crypto.createHash('sha256').update(identity).digest('hex') : '';
  const address = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 120);
  return `${scope || `${req.baseUrl || ''}${req.path || ''}`}:${address}:${identityKey}`;
}

function setHeaders(res, { max, result }) {
  if (typeof res.setHeader !== 'function') return;
  res.setHeader('RateLimit-Limit', String(max));
  res.setHeader('RateLimit-Remaining', String(result.remaining));
  res.setHeader('RateLimit-Reset', String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))));
}

function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, keyBy, scope, store } = {}) {
  const normalizedWindow = normalizeWindow(windowMs);
  const normalizedMax = normalizeMax(max);
  const selectedStore = store || createMemoryRateLimitStore();
  return (req, res, next) => {
    const key = keyForRequest(req, keyBy, scope);
    let result;
    try {
      result = selectedStore.consume(key, { windowMs: normalizedWindow, max: normalizedMax });
    } catch (error) {
      return next(error);
    }
    const finish = (outcome) => {
      setHeaders(res, { max: normalizedMax, result: outcome });
      if (!outcome.allowed)
        if (typeof res.setHeader === 'function')
          res.setHeader('Retry-After', String(Math.max(0, Math.ceil((outcome.resetAt - Date.now()) / 1000))));
      if (!outcome.allowed)
        return res.status(429).json({ success: false, message: 'Trop de tentatives. Réessayez plus tard.' });
      return next();
    };
    if (result && typeof result.then === 'function') return result.then(finish).catch(next);
    return finish(result);
  };
}

rateLimit.createMemoryRateLimitStore = createMemoryRateLimitStore;
rateLimit.createMysqlRateLimitStore = createMysqlRateLimitStore;
rateLimit._clearMemory = () => buckets.clear();

module.exports = rateLimit;
