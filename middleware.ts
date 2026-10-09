import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// A SEPARATE, lightweight Auth.js instance - not `export { auth as
// middleware } from "@/auth"` (the full instance), specifically so this
// Edge-runtime entry point can never reach auth.ts's database-touching
// `signIn` callback, however it's imported. See auth.config.ts's top
// comment: this split is Auth.js's own documented fix
// (authjs.dev/guides/edge-compatibility), and load-bearing here, not
// cosmetic - confirmed by a real Turbopack build failure once auth.ts
// started reaching lib/db/legacy-connection.ts (node:path/process.cwd()),
// which middleware's bundle can never be allowed to need.
export const { auth: middleware } = NextAuth(authConfig);

// The negative-lookahead exclusion pattern Next.js docs recommend here
// compiles fine under webpack but Turbopack's build (`next build --turbopack`,
// which this app uses) has been observed to silently fall back to matching
// every path instead of parsing it - checked via the deployed image's own
// .next/server/middleware-manifest.json, which showed matchers: [{regexp:
// "^/.*$"}] instead of the exclusion. Path exclusion for /api/* now lives in
// auth.config.ts's authorized() callback instead, which is the actual
// enforcement point regardless of what the matcher compiles down to.
export const config = {
  matcher: ["/:path*"],
};
