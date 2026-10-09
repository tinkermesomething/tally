"use server";

import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";
import { updateAppSettings } from "@/lib/db/settings";
import { setAvatarColor, deleteUser } from "@/lib/db/users";
import type { DateFormat } from "@/lib/date-format";

export async function updatePreferences(input: {
  currency?: string;
  dateFormat?: DateFormat;
  carryOverStartYear?: number;
  carryOverStartMonth?: number;
  bankSyncEnabled?: boolean;
  bankSyncFrequencyHours?: number;
  autoBackupEnabled?: boolean;
}) {
  return requireSession(async () => {
    await updateAppSettings(input);
    // The root layout is what fetches these - bust it, not individual page
    // paths, so every route picks up the new values on next navigation.
    revalidatePath("/", "layout");
  });
}

/** Always `user.id` from the resolved session - never a passed-in id, or
 * this would let anyone repaint anyone else's avatar. */
export async function updateAvatarColor(color: string): Promise<void> {
  return requireSession(async (user) => {
    await setAvatarColor(user.id, color);
    revalidatePath("/settings");
  });
}

/** Self-service account deletion - `lib/db/users.ts`'s deleteUser refuses
 * this when the caller is an admin (same rule as the admin-facing delete,
 * just reached from a different direction: here it's always `id ===
 * callerId`, there it never has to be). On success there's no session left
 * to keep around, so this signs out immediately rather than leaving the
 * client to notice its own account is gone on the next request. */
export async function deleteOwnAccountAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await requireSession((user) => deleteUser(user.id, user.id, process.env.ALLOWED_EMAIL));
  if (result.ok) await signOut({ redirectTo: "/signin" });
  return result;
}
