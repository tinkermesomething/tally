export { auth as middleware } from "@/auth";

// The negative-lookahead exclusion pattern Next.js docs recommend here
// compiles fine under webpack but Turbopack's build (`next build --turbopack`,
// which this app uses) has been observed to silently fall back to matching
// every path instead of parsing it - checked via the deployed image's own
// .next/server/middleware-manifest.json, which showed matchers: [{regexp:
// "^/.*$"}] instead of the exclusion. Path exclusion for /api/* now lives in
// auth.ts's authorized() callback instead, which is the actual enforcement
// point regardless of what the matcher compiles down to.
export const config = {
  matcher: ["/:path*"],
};
