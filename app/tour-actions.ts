"use server";

import { requireSession } from "@/lib/session";
import { updateAppSettings } from "@/lib/db/settings";

/** Skip and Done both land here. Setting a flag that is already set changes
 * nothing, so a double click or a replay is harmless. No path revalidation:
 * the tour closes itself, and /grid is dynamic so the next load reads it. */
export async function markTourSeen() {
  return requireSession(async () => {
    await updateAppSettings({ tourSeen: true });
  });
}
