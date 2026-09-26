import { NextResponse } from "next/server";

/**
 * API routes sit outside Auth.js's middleware (its matcher explicitly
 * excludes /api) since a machine client has no browser to complete an OIDC
 * redirect with. Instead they're gated by a separate long-lived bearer
 * token - a standard "service account" pattern, orthogonal to the human
 * session cookie.
 */
export function requireApiToken(request: Request): NextResponse | null {
  const expected = process.env.TALLY_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "TALLY_API_TOKEN is not configured on the server." },
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // authorized
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
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Unknown error" },
        { status: 400 }
      );
    }
  };
}
