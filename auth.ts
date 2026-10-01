import NextAuth from "next-auth";

const allowedEmail = process.env.ALLOWED_EMAIL;

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
export const { handlers, auth, signIn, signOut } = NextAuth((req) => {
  // req is undefined in some internal invocations (confirmed real, not
  // just an overly-cautious type - nextauthjs/next-auth#12741) - fall back
  // to no redirectProxyUrl rather than throwing, letting Auth.js use
  // whatever default behavior applies when there's genuinely no request to
  // read a host from.
  const proto = req?.headers.get("x-forwarded-proto") ?? "https";
  const host = req?.headers.get("x-forwarded-host") ?? req?.headers.get("host");
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
      },
    ],
    trustHost: true,
    redirectProxyUrl,
    session: { strategy: "jwt" },
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
      // This is a single-user app - reject anyone whose pocket-id account isn't
      // the one explicit allowed address, even if pocket-id is later reconfigured
      // with a second account.
      signIn({ profile }) {
        if (!allowedEmail) return true; // no allow-list configured (local dev)
        return profile?.email === allowedEmail;
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
    },
  };
});
