import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import authConfig from "@/auth.config";
import { isDesktopMode } from "@/lib/desktop/mode";
import { SESSION_COOKIE, gateDecision } from "@/lib/desktop/gate";

// A SEPARATE, lightweight Auth.js instance - not `export { auth as
// middleware } from "@/auth"` (the full instance), specifically so this
// Edge-runtime entry point can never reach auth.ts's database-touching
// `signIn` callback, however it's imported. See auth.config.ts's top
// comment: this split is Auth.js's own documented fix
// (authjs.dev/guides/edge-compatibility), and load-bearing here, not
// cosmetic - confirmed by a real Turbopack build failure once auth.ts
// started reaching lib/db/legacy-connection.ts (node:path/process.cwd()),
// which middleware's bundle can never be allowed to need.
const { auth } = NextAuth(authConfig);

// Desktop has no sign-in at all (authConfig lets everything through), so
// the only gate is "does this request come from the app's own window" -
// see lib/desktop/gate.ts. Web mode is untouched.
async function desktopGate(req: NextRequest) {
  const decision = await gateDecision({
    host: req.headers.get("host"),
    pathname: req.nextUrl.pathname,
    cookie: req.cookies.get(SESSION_COOKIE)?.value,
    token: process.env.LAUNCH_TOKEN,
    port: process.env.PORT,
  });
  return decision === "allow" ? NextResponse.next() : new NextResponse("Forbidden", { status: 403 });
}

export const middleware = isDesktopMode() ? desktopGate : auth;

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
