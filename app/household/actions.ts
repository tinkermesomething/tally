"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { toResult, type ActionResult } from "@/lib/action-result";
import { setHouseholdEnabled } from "@/lib/db/household";
import type { UserRow } from "@/lib/db/users";

/** Same re-check-isAdmin-in-the-action convention as
 * app/settings/users-actions.ts - SSR gating (only rendering the switch for
 * an admin) is not enforcement; a server action is a public endpoint. */
function assertAdmin(user: UserRow) {
  if (!user.isAdmin) throw new Error("Admins only.");
}

export async function setHouseholdEnabledAction(enabled: boolean): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      assertAdmin(user);
      await setHouseholdEnabled(enabled);
      // Every page's nav and every category/income row's toggle visibility
      // depends on this - bust the whole tree, not one path.
      revalidatePath("/", "layout");
    })
  );
}
