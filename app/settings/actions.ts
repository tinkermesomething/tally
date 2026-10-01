"use server";

import { revalidatePath } from "next/cache";
import { updateAppSettings } from "@/lib/db/settings";
import type { DateFormat } from "@/lib/date-format";

export async function updatePreferences(input: {
  currency?: string;
  dateFormat?: DateFormat;
  carryOverStartYear?: number;
  carryOverStartMonth?: number;
}) {
  await updateAppSettings(input);
  // The root layout is what fetches these - bust it, not individual page
  // paths, so every route picks up the new values on next navigation.
  revalidatePath("/", "layout");
}
