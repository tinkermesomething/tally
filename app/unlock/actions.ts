"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDesktopMode } from "@/lib/desktop/mode";
import { SESSION_COOKIE, sessionCookieValue } from "@/lib/desktop/gate";
import { isLockEnabled, verifyLockPassword } from "@/lib/desktop/lock";
import { checkRateLimit } from "@/lib/rate-limit";

export type UnlockState = { error: string | null };

// A local program can't get here without the launch token, so this is
// defence in depth: it just stops a script hammering the password.
const MAX_ATTEMPTS_PER_WINDOW = 5;
const WINDOW_MS = 60_000;

/** Trades the app-lock password for the full session cookie (see
 * lib/desktop/gate.ts). Reachable by a locked window - and by a full one,
 * where it just goes to the grid. */
export async function unlockAction(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const token = process.env.LAUNCH_TOKEN;
  if (!isDesktopMode() || !token || !isLockEnabled()) redirect("/grid");

  const limit = checkRateLimit("desktop-unlock", MAX_ATTEMPTS_PER_WINDOW, WINDOW_MS);
  if (!limit.allowed) return { error: "Too many attempts. Wait a minute and try again." };

  if (!verifyLockPassword(String(formData.get("password") ?? ""))) return { error: "Wrong password." };

  (await cookies()).set(SESSION_COOKIE, await sessionCookieValue(token), { httpOnly: true, sameSite: "strict", path: "/" });
  redirect("/grid");
}
