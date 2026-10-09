import type { NextAuthConfig } from "next-auth";
import { allowedHostFrom, parseAllowedHosts } from "@/lib/auth-rules";

// Which hosts this app answers requests for - everything below that reads a
// request's own Host/X-Forwarded-Host header checks it against this list
// first. Without it, a request carrying an arbitrary Host header (anything
// that reaches this process without Caddy normalising it first) could steer
// the OAuth redirect_uri and the post-login redirect to an origin of the
// attacker's choosing - trustHost exists so this app can serve TWO real
// hostnames, not so it trusts every hostname. Comma-separated; the two real
// hostnames are the default so a config omission still fails safe to
// something real rather than open to anything.
const ALLOWED_HOSTS = parseAllowedHosts(process.env.ALLOWED_HOSTS ?? "tally.home.internal,tally.angelsomething.com");

/** The Edge-safe half of the Auth.js config - no database access anywhere
 * in here, which is why this is its OWN file rather than a part of auth.ts.
 * middleware.ts builds its own lightweight Auth.js instance straight from
 * this; auth.ts (the full instance used everywhere else) spreads this and
 * adds the one callback that isn't edge-safe (`signIn`, which audits to the
 * database). This split is Auth.js's own documented fix for exactly this
 * problem (authjs.dev/guides/edge-compatibility) - and it's load-bearing,
 * not just tidy: confirmed with a real build failure, Turbopack bundles
 * whatever a config object references for EVERY entry point that can reach
 * it, dynamic import or not, so the database-touching callback has to be
 * structurally absent from what middleware imports, not just unreachable
 * at runtime. */
export default function authConfig(req?: Request): NextAuthConfig {
  // Lazy initialization (a function, not a plain object) - this app is
  // reachable on two real hostnames (tally.home.internal AND
  // tally.angelsomething.com, both behind Caddy), and NEITHER a fixed
  // AUTH_URL nor leaving it unset (relying on trustHost's own per-step
  // inference) worked: unset, Auth.js derived a DIFFERENT redirect_uri for
  // the authorize step than for the token-exchange step, and pocket-id
  // correctly rejected the mismatch (invalid_grant, confirmed live via the
  // container's own auth.js error log); hardcoded to one domain, the
  // state/PKCE cookie Auth.js sets while actually on the OTHER domain
  // silently fails to round-trip (InvalidCheck, also confirmed live).
  // redirectProxyUrl - computed fresh per REQUEST from that request's own
  // forwarded host - pins the SAME redirect_uri for every step of one login,
  // whichever of the two domains it happens on. Confirmed against Auth.js's
  // own docs (authjs.dev/reference/nextjs), not assumed from how trustHost
  // is "supposed to" behave - that assumption is what broke login twice
  // already.
  //
  // req is undefined in some internal invocations (confirmed real, not
  // just an overly-cautious type - nextauthjs/next-auth#12741) - fall back
  // to no redirectProxyUrl rather than throwing, letting Auth.js use
  // whatever default behavior applies when there's genuinely no request to
  // read a host from.
  const proto = req?.headers.get("x-forwarded-proto") ?? "https";
  const rawHost = req?.headers.get("x-forwarded-host") ?? req?.headers.get("host");
  // An unrecognized Host is treated the same as no host at all (safe
  // default), never trusted into a redirect_uri or a redirect target.
  const host = allowedHostFrom(rawHost, ALLOWED_HOSTS);
  const redirectProxyUrl = host ? `${proto}://${host}/api/auth` : undefined;

  return {
    providers: [
      {
        id: "pocket-id",
        name: "Pocket ID",
        type: "oidc",
        issuer: process.env.OIDC_ISSUER,
        clientId: process.env.OIDC_CLIENT_ID,
        clientSecret: process.env.OIDC_CLIENT_SECRET,
        // Auth.js's default checks for a generic "oidc" provider omit the
        // OAuth `state` param (relying on PKCE alone for CSRF protection,
        // which is spec-legal). pocket-id's OAuth2 library (ory/fosite)
        // hard-requires `state` regardless - every authorize request came
        // back "invalid_state" until this was added, confirmed by reading
        // fosite's own source (authorize_request_handler.go: rejects any
        // request where len(state) is below its minimum entropy, and an
        // absent state has length 0).
        checks: ["pkce", "state"],
        // "groups" isn't in the default openid/profile/email scope set -
        // without it pocket-id never puts a "groups" claim on the profile
        // at all, and lib/accounts-rules.ts's hasAdminGroup (admin status,
        // re-derived every sign-in) would silently always see nothing.
        authorization: { params: { scope: "openid profile email groups" } },
      },
    ],
    trustHost: true,
    redirectProxyUrl,
    session: {
      strategy: "jwt",
      // A signed-in tab left open for weeks is a bigger risk than the mild
      // inconvenience of a re-login - 7 days, refreshed on activity, not
      // Auth.js's 30-day default.
      maxAge: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    pages: {
      // Custom page instead of Auth.js's auto-generated one, which guesses a
      // provider icon from its own external CDN - there's no entry there for
      // pocket-id (not a bundled provider), so it rendered as a broken image.
      signIn: "/signin",
    },
    callbacks: {
      // redirectProxyUrl only fixes the OAuth-PROVIDER-facing redirect_uri
      // (the authorize/token-exchange steps) - it does nothing for the
      // SEPARATE question of where Auth.js sends the browser once login
      // actually completes. That step still fell back to Auth.js's own
      // internally-resolved baseUrl, which is the SAME broken
      // "https://0.0.0.0:3000" origin found earlier in the bank-sync
      // callback route (confirmed live: login completed - the session
      // cookie was already set - but landed on an unreachable 0.0.0.0 URL,
      // only becoming visible as "logged in" after manually reloading the
      // real domain). realBaseUrl reuses the SAME per-request
      // proto/host this closure already computed for redirectProxyUrl,
      // rather than trusting whatever baseUrl Auth.js itself resolved.
      // Default-implementation shape confirmed against Auth.js's own docs
      // (authjs.dev/reference/core's redirect callback reference).
      redirect({ url, baseUrl }) {
        const realBaseUrl = host ? `${proto}://${host}` : baseUrl;
        if (url.startsWith("/")) return `${realBaseUrl}${url}`;
        try {
          const parsed = new URL(url);
          if (parsed.origin === baseUrl || parsed.origin === realBaseUrl) {
            return `${realBaseUrl}${parsed.pathname}${parsed.search}`;
          }
        } catch {
          // url wasn't a valid absolute URL - fall through to the safe default
        }
        return realBaseUrl;
      },
      authorized({ request, auth }) {
        // Belt-and-suspenders: middleware.ts's matcher is meant to keep this
        // callback from ever running on these paths in the first place, but
        // Turbopack's build has been observed to compile that matcher down to
        // a catch-all (see middleware.ts) - without this check, a broken
        // matcher makes NextAuth's own csrf/callback endpoints unreachable
        // (this callback returning false redirects them to the sign-in page,
        // which can never get a session to redirect from), breaking login
        // entirely rather than just weakening the gate. Static assets need
        // the same exclusion: an unauthenticated request for the page's own
        // CSS/JS chunks was getting redirected too (307 instead of 200),
        // which is why /signin rendered with zero styling - the browser
        // never got real CSS back, just another redirect.
        const { pathname } = request.nextUrl;
        const isPublicPath =
          pathname.startsWith("/api") ||
          pathname === "/signin" ||
          pathname.startsWith("/_next/static") ||
          pathname.startsWith("/_next/image") ||
          pathname === "/favicon.ico";
        if (isPublicPath) return true;
        return !!auth;
      },
      // Neither callback below touches the database - both are pure
      // claim-copying, which is why they're safe to live here (Edge-safe)
      // rather than in auth.ts. NextAuth's own JWT does NOT default
      // `token.sub` to the OIDC provider's `sub` claim (confirmed against
      // authjs.dev/reference/nextjs, not assumed) - without this, every
      // per-user lookup downstream (lib/db/current-user.ts) would have
      // nothing reliable to key off.
      jwt({ token, profile, trigger }) {
        if (trigger === "signIn" && profile?.sub) token.sub = profile.sub;
        return token;
      },
      session({ session, token }) {
        if (token.sub) session.user.sub = token.sub;
        return session;
      },
      // signIn deliberately NOT here - see this file's top comment.
    },
  };
}
