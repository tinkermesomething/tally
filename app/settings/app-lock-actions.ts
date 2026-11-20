"use server";

import { requireSession } from "@/lib/session";
import { toResult, type ActionResult } from "@/lib/action-result";
import { isDesktopMode } from "@/lib/desktop/mode";
import { isLockEnabled, lockAttemptError, removeLock, setLockPassword, verifyLockPassword } from "@/lib/desktop/lock";

// Desktop only (the web build has real sign-in). Every change to an
// existing lock needs the CURRENT password: a window left open on an
// unlocked computer must not be able to quietly swap or remove it.

function requireDesktop() {
  if (!isDesktopMode()) throw new Error("The app lock is only in the desktop app.");
}

function requireCurrentPassword(current: string) {
  const tooMany = lockAttemptError("desktop-lock-change");
  if (tooMany) throw new Error(tooMany);
  if (!verifyLockPassword(current)) throw new Error("The current password is wrong.");
}

/** Turns the lock on, or changes its password when one is already set.
 * Takes effect the next time Tally opens (or on "Lock now"). */
export async function setAppLockAction(newPassword: string, currentPassword: string): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      requireDesktop();
      if (isLockEnabled()) requireCurrentPassword(currentPassword);
      setLockPassword(newPassword);
    })
  );
}

export async function removeAppLockAction(currentPassword: string): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      requireDesktop();
      if (!isLockEnabled()) return;
      requireCurrentPassword(currentPassword);
      removeLock();
    })
  );
}
