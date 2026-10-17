/**
 * Very small in-memory rate limiter (fixed window).
 *
 * Good enough to stop accidental request floods in a demo. It is per server
 * instance, so on Vercel (many short-lived instances) it is not a real
 * security control; use a shared store such as Redis for that.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || now >= h.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (h.count >= limit) return false;
  h.count += 1;
  return true;
}
