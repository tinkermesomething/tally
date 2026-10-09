"use server";

import { requireSession } from "@/lib/session";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  archiveBankAccount,
  deactivateCategoryRule,
  syncBankAccount,
  setBankAccountAlias,
} from "@/lib/db/bank-sync";
import { toResult, type ActionResult } from "@/lib/action-result";
import {
  listInstitutions,
  createAgreement,
  createRequisition,
  PENDING_CONNECTION_COOKIE,
  type PendingConnection,
} from "@/lib/gocardless";
import { setGocardlessCredentials, clearGocardlessCredentials } from "@/lib/db/gocardless-credentials";

export async function syncBankAccountNow(id: number): Promise<{ staged: number }> {
  return requireSession(async () => {
    const result = await syncBankAccount(id);
    revalidatePath("/settings");
    revalidatePath("/review");
    return result;
  });
}

/** Gives an account your own name (empty clears it back to the bank's label). */
export async function renameBankAccount(id: number, alias: string): Promise<ActionResult> {
  return requireSession(() =>
    toResult(async () => {
      await setBankAccountAlias(id, alias);
      revalidatePath("/settings");
      revalidatePath("/review");
    })
  );
}

export async function archiveLinkedBankAccount(id: number) {
  return requireSession(async () => {
    await archiveBankAccount(id);
    revalidatePath("/settings");
  });
}

export async function listBankInstitutions() {
  return requireSession(async () => {
    const institutions = await listInstitutions("GB");
    return institutions
      .map((i) => ({
        id: i.id,
        name: i.name,
        transaction_total_days: i.transaction_total_days,
        max_access_valid_for_days: i.max_access_valid_for_days,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/** Starts the GoCardless consent flow: creates an agreement scoped to this
 * institution's own real limits (never a hardcoded constant - a value
 * above an institution's own transaction_total_days is a hard 400,
 * confirmed by testing live), then a requisition, stashes correlation
 * state in an httpOnly cookie (see PENDING_CONNECTION_COOKIE's own comment
 * for why - not query params), and hands back the link to send the user
 * to their bank. */
export async function startBankConnection(institution: {
  id: string;
  name: string;
  transaction_total_days: number;
  max_access_valid_for_days: number;
}): Promise<{ link: string }> {
  return requireSession(async (user) => {
    const redirectUrl = process.env.GOCARDLESS_REDIRECT_URL;
    if (!redirectUrl) throw new Error("GOCARDLESS_REDIRECT_URL is not configured.");

    const agreement = await createAgreement(institution);
    const reference = crypto.randomUUID();
    const requisition = await createRequisition({
      institutionId: institution.id,
      agreementId: agreement.id,
      redirectUrl,
      reference,
    });

    const pending: PendingConnection = {
      // Bound to whoever started this - the callback refuses to apply it
      // under a DIFFERENT signed-in user (two people sharing one browser,
      // one leaving a session open, could otherwise land account A's bank
      // link under account B).
      userId: user.id,
      requisitionId: requisition.id,
      institutionId: institution.id,
      institutionName: institution.name,
      accessValidForDays: agreement.access_valid_for_days,
    };
    const store = await cookies();
    store.set(PENDING_CONNECTION_COOKIE, JSON.stringify(pending), {
      httpOnly: true,
      // Lax (never Strict) - the user leaves to their bank's domain and
      // GoCardless redirects them back via a top-level GET; Strict drops the
      // cookie on exactly that cross-site-origin navigation, which would
      // silently break every single connection attempt.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60,
      path: "/",
    });

    return { link: requisition.link };
  });
}

/** Saves the GoCardless API credentials for the whole instance - one
 * developer/sandbox registration shared by every user's bank connections,
 * not a per-account secret, so this is admin-only (Settings > Admin).
 * Both fields are required together: a partial update (e.g. rotating only
 * the key) isn't offered - simplest correct behaviour, and GoCardless
 * issues them as a pair anyway. */
export async function saveGocardlessCredentialsAction(secretId: string, secretKey: string): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      if (!user.isAdmin) throw new Error("Admins only.");
      const trimmedId = secretId.trim();
      const trimmedKey = secretKey.trim();
      if (!trimmedId || !trimmedKey) throw new Error("Enter both the secret id and the secret key.");
      await setGocardlessCredentials(trimmedId, trimmedKey);
      revalidatePath("/settings");
    })
  );
}

export async function clearGocardlessCredentialsAction(): Promise<ActionResult> {
  return requireSession((user) =>
    toResult(async () => {
      if (!user.isAdmin) throw new Error("Admins only.");
      await clearGocardlessCredentials();
      revalidatePath("/settings");
    })
  );
}

export async function removeCategoryRule(id: number) {
  return requireSession(async () => {
    await deactivateCategoryRule(id);
    revalidatePath("/settings");
  });
}
