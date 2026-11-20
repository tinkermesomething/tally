import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, UNLOCK_PATH, sessionCookieValue } from "@/lib/desktop/gate";
import { desktopLockActive } from "@/lib/desktop/lock";

// "Lock now" (Settings > App lock): drops this window back to the unlock
// screen. A plain redirect, not a server action - an action that changes the
// cookie makes Next re-render the page under the NEW cookie, which the gate
// then refuses. Needs the full session cookie to get here at all (middleware),
// and the cookie is SameSite=Strict, so no other site can trigger it.
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.LAUNCH_TOKEN;
  if (!token || !desktopLockActive()) return new NextResponse(null, { status: 404 });
  const res = new NextResponse(null, { status: 303, headers: { Location: UNLOCK_PATH } });
  res.cookies.set(SESSION_COOKIE, await sessionCookieValue(token, "locked"), SESSION_COOKIE_OPTIONS);
  return res;
}
