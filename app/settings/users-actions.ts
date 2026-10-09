"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { toResult, type ActionResult } from "@/lib/action-result";
import { inviteUser, listUsers, setUserDisabled, relinkUserSub, deleteUser, type UserRow } from "@/lib/db/users";
import { canDisable, checkInviteEmail } from "@/lib/accounts-rules";

/** Every action here re-checks isAdmin itself, even though the Users tab
 * is only ever rendered for an admin (app/settings/page.tsx) - that's SSR
 * gating, not enforcement; a server action is a public HTTP endpoint any
 * signed-in session could call directly. */
function assertAdmin(user: UserRow) {
  if (!user.isAdmin) throw new Error("Admins only.");
}

export async function inviteUserAction(email: string): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      assertAdmin(user);
      const existing = await listUsers();
      const problem = checkInviteEmail(email, existing.map((u) => u.email));
      if (problem) throw new Error(problem);
      await inviteUser(email.trim());
      revalidatePath("/settings");
    })
  );
}

export async function setUserDisabledAction(id: number, disabled: boolean): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      assertAdmin(user);
      if (disabled) {
        const target = (await listUsers()).find((u) => u.id === id);
        if (!target) throw new Error("That account no longer exists.");
        if (!canDisable({ email: target.email, isAdmin: target.isAdmin }, process.env.ALLOWED_EMAIL)) {
          throw new Error("That account can't be disabled.");
        }
      }
      await setUserDisabled(id, disabled);
      revalidatePath("/settings");
    })
  );
}

/** Permanently removes an account and its encrypted data - see
 * lib/db/users.ts's deleteUser for what that actually does and refuses
 * (the bootstrap admin, your own account). No undo - the confirmation
 * dialog is in the client component, this is the real enforcement. */
export async function deleteUserAction(id: number): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      assertAdmin(user);
      const result = await deleteUser(id, user.id, process.env.ALLOWED_EMAIL);
      if (!result.ok) throw new Error(result.error);
      revalidatePath("/settings");
    })
  );
}

/** Re-points an existing account at a different OIDC `sub` - for someone
 * ELSE whose pocket-id identity changed and can no longer sign in. Not
 * self-service: a session that can still reach this page already proves
 * its own sub is fine. `newSub` has to come from that person's own IdP
 * profile (there is no UI flow yet to capture it live - an admin reads it
 * from pocket-id's own user list, same as any other break-glass step). */
export async function relinkUserSubAction(id: number, newSub: string): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      assertAdmin(user);
      const trimmed = newSub.trim();
      if (!trimmed) throw new Error("Enter the new identity's sub value.");
      const result = await relinkUserSub(id, trimmed);
      if (!result.ok) throw new Error(result.error);
      revalidatePath("/settings");
    })
  );
}
