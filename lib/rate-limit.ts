/** A small in-memory fixed-window rate limiter. Good enough for this app:
 * one long-lived process, not serverless/multi-instance, so a plain Map
 * survives for the process's whole life - no Redis needed for a single
 * container. Never persisted, so a restart clears every counter; that's
 * fine here, it only throttles brute-force/hammering within a run. */

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

// Without this, a steady trickle of distinct keys (e.g. different IPs)
// would grow the map forever across a long-lived process.
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

/** `key` scopes the limit (e.g. "api-token:<ip>"); `max` requests are
 * allowed per `windowMs`, then further calls are refused until the window
 * resets. Pure apart from the module-level Map, so `now` is injectable for
 * tests. */
export function checkRateLimit(key: string, max: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS && !w) evictOldest(now);
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count++;
  return { allowed: w.count <= max, remaining: Math.max(0, max - w.count), resetAt: w.resetAt };
}

function evictOldest(now: number) {
  for (const [k, w] of windows) {
    if (w.resetAt <= now) windows.delete(k);
  }
  // Still over the cap (all windows genuinely live, e.g. a very large fleet
  // of distinct keys within one window) - drop the single oldest rather
  // than let the map grow without bound.
  if (windows.size >= MAX_TRACKED_KEYS) {
    const oldest = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)[0];
    if (oldest) windows.delete(oldest[0]);
  }
}

/** Test-only: clears all counters. */
export function resetRateLimits() {
  windows.clear();
}

/** Best-effort client identifier from proxy headers. This app's live
 * Caddyfile isn't in this repo, so whether it actually sets these two
 * headers is UNVERIFIED, not confirmed - check that before trusting
 * per-client limiting in production. Falls back to a shared bucket when
 * neither header is present (e.g. local dev without a proxy in front, or
 * Caddy not forwarding them) - that still throttles overall volume, just
 * not per-client. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
