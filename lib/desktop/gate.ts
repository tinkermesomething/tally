// Desktop has no login, and the server listens on a loopback port - so
// without this, a web page probing localhost, a DNS-rebinding page, or a
// local program that doesn't know the token could talk to it as the one
// local user, backup download and restore included. Every request must come
// from the app's own window. (Not a defence against malware running as the
// same OS user: it can read the server's environment. The OS user is the
// real boundary.) Edge-safe (WebCrypto only): middleware.ts runs it.
//
// How the window proves it: the launcher gives the server a random
// LAUNCH_TOKEN and opens the window at /api/desktop/enter?t=<token>. That
// route swaps the token for a cookie that is an HMAC OF the token, never
// the token itself. HttpOnly + SameSite=Strict, so no page script and no
// other site's request carries it. A new token every launch means a stolen
// cookie dies with the session.
// The Host check stops DNS rebinding: a rebound page reaches this server
// under ITS own hostname, which is never 127.0.0.1:<port>.

export const SESSION_COOKIE = "tally_desktop";
export const ENTER_PATH = "/api/desktop/enter";
const HEALTH_PATH = "/api/health";
export const UNLOCK_PATH = "/unlock";

// All a locked window may fetch: the unlock page, and the assets it needs to render.
const LOCKED_STATIC_PREFIXES = ["/_next/static/"];
const LOCKED_STATIC_FILES = ["/favicon.ico", "/icon.svg", "/apple-icon.png"];
function lockedMayReach(pathname: string): boolean {
  return pathname === UNLOCK_PATH || LOCKED_STATIC_FILES.includes(pathname) || LOCKED_STATIC_PREFIXES.some((p) => pathname.startsWith(p));
}

const enc = new TextEncoder();

/** "session" opens the whole app. "locked" is what a window gets while an
 * app lock (lib/desktop/lock.ts) is waiting for its password: it proves the
 * request is from our window but reaches only the unlock screen. */
export type CookieKind = "session" | "locked";

/** Set on every cookie this module's values go into: no page script can read it,
 * and no other site's request carries it. */
export const SESSION_COOKIE_OPTIONS = { httpOnly: true, sameSite: "strict", path: "/" } as const;

// The token never changes while the server runs, so each value is computed once, not on every request.
const cookieValues = new Map<string, Promise<string>>();

export function sessionCookieValue(token: string, kind: CookieKind = "session"): Promise<string> {
  const id = `${kind}:${token}`;
  let value = cookieValues.get(id);
  if (!value) {
    value = (async () => {
      const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`tally-desktop-${kind}-v1`));
      return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
    })();
    cookieValues.set(id, value);
  }
  return value;
}

/** Does `cookie` open the whole app (not just the unlock screen)? */
export async function hasSessionCookie(cookie: string | undefined, token: string | undefined): Promise<boolean> {
  return !!cookie && !!token && safeEqual(cookie, await sessionCookieValue(token));
}

/** Constant-time string compare (no node:crypto in the Edge runtime). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function isAllowedHost(host: string | null, port: string | undefined): boolean {
  return !!port && host === `127.0.0.1:${port}`;
}

export type GateInput = {
  host: string | null;
  pathname: string;
  cookie: string | undefined;
  token: string | undefined;
  port: string | undefined;
};

/** "allow" or "deny" - and deny is the answer whenever anything is missing,
 * including the token or port env (a mis-launched server fails closed). */
export async function gateDecision({ host, pathname, cookie, token, port }: GateInput): Promise<"allow" | "deny"> {
  if (!token || !isAllowedHost(host, port)) return "deny";
  // The launcher's readiness probe (no cookie) and the token-for-cookie swap
  // (validated by the route itself) are the only requests that need no cookie.
  if (pathname === HEALTH_PATH || pathname === ENTER_PATH) return "allow";
  if (!cookie) return "deny";
  if (await hasSessionCookie(cookie, token)) return "allow";
  if (safeEqual(cookie, await sessionCookieValue(token, "locked")) && lockedMayReach(pathname)) return "allow";
  return "deny";
}
