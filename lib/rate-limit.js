/**
 * حد بسيط لعدد الطلبات لكل IP (في الذاكرة، يكفي لسيرفر واحد).
 * الهدف: حماية مفتاح الـ API من الاستهلاك العشوائي لأن الـ endpoint مفتوح للعالم.
 * RATE_LIMIT_PER_MIN=0 يطفّي الحد.
 */
export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const hits = new Map();

  return function rateLimit(req, res, next) {
    if (!max || max <= 0) return next();

    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const entry = hits.get(ip);

    if (!entry || entry.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      if (hits.size > 5000) sweep(hits, now);
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `عدد الطلبات كثير حاليًا (الحد ${max} في الدقيقة). انتظر ${retryAfter} ثانية وجرّب مرة ثانية.`,
      });
    }

    return next();
  };
}

function sweep(hits, now) {
  for (const [key, value] of hits) {
    if (value.resetAt <= now) hits.delete(key);
  }
}
