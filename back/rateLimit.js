const buckets = new Map();

function rateLimit({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = `${req.baseUrl}${req.path}:${req.ip || req.socket.remoteAddress}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) bucket = { count: 0, until: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 5000) {
      for (const [entry, value] of buckets) if (value.until <= now) buckets.delete(entry);
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
