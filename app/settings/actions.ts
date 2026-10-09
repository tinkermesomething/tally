"use server";

import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { updateAppSettings } from "@/lib/db/settings";
import { setAvatarColor } from "@/lib/db/users";
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
