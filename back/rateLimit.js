const buckets = new Map();
const crypto = require('crypto');

function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, keyBy } = {}) {
  return (req, res, next) => {
    const identity = typeof keyBy === 'function' ? String(keyBy(req) || '').trim().toLowerCase().slice(0,120) : '';
    const identityKey = identity ? crypto.createHash('sha256').update(identity).digest('hex') : '';
    const key = `${req.baseUrl}${req.path}:${req.ip || req.socket.remoteAddress}:${identityKey}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) bucket = { count: 0, until: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 5000) {
      for (const [entry, value] of buckets) {
        if (value.until <= now) buckets.delete(entry);
        if (buckets.size <= 4000) break;
      }
    }
    if (buckets.size > 10000) {
      while (buckets.size > 9000) buckets.delete(buckets.keys().next().value);
    }
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
      return res.status(429).json({ success: false, message: 'Trop de tentatives. Réessayez plus tard.' });
    }
    next();
  };
}

module.exports = rateLimit;
