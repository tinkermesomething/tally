"use server";

import { cookies } from "next/headers";
import type { RuleCondition } from "@/lib/rules";
import { revalidatePath } from "next/cache";
import {
  archiveBankAccount,
  addCategoryRule,
  type RuleTarget,
  updateCategoryRule,
  deactivateCategoryRule,
  syncBankAccount,
} from "@/lib/db/bank-sync";
import {
  listInstitutions,
  createAgreement,
  createRequisition,
  PENDING_CONNECTION_COOKIE,
  type PendingConnection,
} from "@/lib/gocardless";

export async function syncBankAccountNow(id: number): Promise<{ staged: number }> {
  const result = await syncBankAccount(id);
  revalidatePath("/settings");
  revalidatePath("/review");
  return result;
}

export async function archiveLinkedBankAccount(id: number) {
  await archiveBankAccount(id);
  revalidatePath("/settings");
}

export async function listBankInstitutions() {
  const institutions = await listInstitutions("GB");
  return institutions
    .map((i) => ({
      id: i.id,
      name: i.name,
      transaction_total_days: i.transaction_total_days,
      max_access_valid_for_days: i.max_access_valid_for_days,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
}

export async function createCategoryRule(
  input: { conditions: RuleCondition[] } & RuleTarget
) {
  // addCategoryRule validates the conditions itself (and throws a
  // readable message) - this is just the revalidating wrapper.
  await addCategoryRule(input);
  revalidatePath("/settings");
}

export async function editCategoryRule(
  id: number,
  input: { conditions: RuleCondition[] } & RuleTarget
) {
  await updateCategoryRule(id, input);
  revalidatePath("/settings");
}

export async function removeCategoryRule(id: number) {
  await deactivateCategoryRule(id);
  revalidatePath("/settings");
}
