"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, sessionCookieValue } from "@/lib/desktop/gate";
import { desktopLockActive, lockAttemptError, verifyLockPassword } from "@/lib/desktop/lock";

export type UnlockState = { error: string | null };

/** Trades the app-lock password for the full session cookie (see
 * lib/desktop/gate.ts). Reachable by a locked window - and by a full one,
 * where it just goes to the grid. */
export async function unlockAction(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const token = process.env.LAUNCH_TOKEN;
  if (!token || !desktopLockActive()) redirect("/grid");

  const tooMany = lockAttemptError("desktop-unlock");
  if (tooMany) return { error: tooMany };

  if (!verifyLockPassword(String(formData.get("password") ?? ""))) return { error: "Wrong password." };

  (await cookies()).set(SESSION_COOKIE, await sessionCookieValue(token), SESSION_COOKIE_OPTIONS);
  redirect("/grid");
}
