import { NextResponse } from "next/server";
import { isDesktopMode } from "@/lib/desktop/mode";
import { SESSION_COOKIE, UNLOCK_PATH, safeEqual, sessionCookieValue } from "@/lib/desktop/gate";
import { isLockEnabled } from "@/lib/desktop/lock";

// The desktop window's first request: trades the launcher's one-time-per-run
// token for the session cookie middleware.ts then requires (see
// lib/desktop/gate.ts). Reached without a cookie, so it checks the token
// itself. Everything else about the request (Host) was already checked.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = process.env.LAUNCH_TOKEN;
  const given = new URL(request.url).searchParams.get("t");
  if (!isDesktopMode() || !expected || !given || !safeEqual(given, expected)) {
    return new NextResponse(null, { status: 404 });
  }
  // With an app lock set, the window starts locked: it gets the cookie that
  // reaches only the unlock screen. Without one it goes straight in.
  // A relative Location, never built from request.url: no dependence on
  // whatever origin the server thinks it is bound to.
  const locked = isLockEnabled();
  const res = new NextResponse(null, { status: 303, headers: { Location: locked ? UNLOCK_PATH : "/grid" } });
  res.cookies.set(SESSION_COOKIE, await sessionCookieValue(expected, locked ? "locked" : "session"), { httpOnly: true, sameSite: "strict", path: "/" });
  return res;
}
