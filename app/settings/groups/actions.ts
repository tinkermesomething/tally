"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { renameGroup, setGroupColor } from "@/lib/db/groups";

function refresh() {
  for (const path of ["/grid", "/reports", "/settings", "/settings/groups", "/household"]) revalidatePath(path);
}

export async function renameGroupAction(oldName: string, newName: string) {
  return requireSession(async () => {
    await renameGroup(oldName, newName);
    refresh();
  });
}

export async function setGroupColorAction(name: string, color: string | null) {
  return requireSession(async () => {
    await setGroupColor(name, color);
    refresh();
  });
}
