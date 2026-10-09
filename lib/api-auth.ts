import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "./audit";
import { checkRateLimit, clientIp } from "./rate-limit";
import { enterUserDb } from "./db/context";
import { getLegacyConn } from "./db/legacy-connection";

/**
 * API routes sit outside Auth.js's middleware (its matcher explicitly
 * excludes /api) since a machine client has no browser to complete an OIDC
 * redirect with. Instead they're gated by a separate long-lived bearer
 * token - a standard "service account" pattern, orthogonal to the human
 * session cookie.
 */

// Generous enough that a real client retrying a flaky connection never
// trips it, tight enough that guessing the token by brute force is not a
// realistic path - at this rate, trying even a 6-character token space
// would take centuries.
const MAX_FAILURES_PER_WINDOW = 20;
const WINDOW_MS = 60_000;

export function requireApiToken(request: Request): NextResponse | null {
  // Established before anything below, including the failure path - a
  // rejected token still writes to the audit log (see the call near the
  // bottom), so the database has to be reachable even on an unauthorized
  // request. See lib/db/legacy-connection.ts for what connection this is.
  enterUserDb(getLegacyConn());

  const expected = process.env.TALLY_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "TALLY_API_TOKEN is not configured on the server." },
      { status: 503 }
    );
  }

  const ip = clientIp(request);
  const limit = checkRateLimit(`api-token:${ip}`, MAX_FAILURES_PER_WINDOW, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || !safeEqual(token, expected)) {
    void audit("api_token_rejected", new URL(request.url).pathname, ip);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // authorized
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Wraps a route handler with the bearer-token check and a consistent
 * {error} JSON response for anything the handler throws (validation errors
 * etc.), so each route only needs to write its own logic. */
export function apiRoute<Ctx>(
  handler: (request: Request, ctx: Ctx) => Promise<NextResponse>
) {
  return async (request: Request, ctx: Ctx) => {
    const unauthorized = requireApiToken(request);
    if (unauthorized) return unauthorized;
    try {
      return await handler(request, ctx);
    } catch (err) {
      // Database errors are server faults, not bad input: keep their text
      // (table/column names) out of the response and report them as 500.
      if (err instanceof Error && "code" in err && String(err.code).startsWith("SQLITE_")) {
        console.error("[api] database error:", err);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Unknown error" },
        { status: 400 }
      );
    }
  };
}
