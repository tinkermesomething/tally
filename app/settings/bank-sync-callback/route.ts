import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRequisition, getAccountMeta, PENDING_CONNECTION_COOKIE, type PendingConnection } from "@/lib/gocardless";
import { linkOrRenewBankAccount } from "@/lib/db/bank-sync";

// Where GoCardless (or the end-user's bank) redirects back to after the
// consent step. No query params from that redirect are trusted - see
// PENDING_CONNECTION_COOKIE's comment - all correlation state comes from
// the httpOnly cookie startBankConnection set before sending the user away.
export async function GET(request: Request) {
  const settingsUrl = new URL("/settings?tab=bank-sync", request.url);

  const store = await cookies();
  const raw = store.get(PENDING_CONNECTION_COOKIE)?.value;
  store.delete(PENDING_CONNECTION_COOKIE);

  if (!raw) {
    settingsUrl.searchParams.set("bankSyncError", "missing_state");
    return NextResponse.redirect(settingsUrl);
  }

  let pending: PendingConnection;
  try {
    pending = JSON.parse(raw);
  } catch {
    settingsUrl.searchParams.set("bankSyncError", "missing_state");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const requisition = await getRequisition(pending.requisitionId);

    if (requisition.status !== "LN") {
      settingsUrl.searchParams.set("bankSyncError", `not_linked_${requisition.status}`);
      return NextResponse.redirect(settingsUrl);
    }

    const consentExpiresAt = new Date(Date.now() + pending.accessValidForDays * 24 * 60 * 60 * 1000);

    for (const accountId of requisition.accounts) {
      const meta = await getAccountMeta(accountId);
      const accountLabel = meta.name?.trim() || meta.iban || accountId;
      await linkOrRenewBankAccount({
        provider: "gocardless",
        institutionId: pending.institutionId,
        requisitionId: pending.requisitionId,
        externalAccountId: accountId,
        displayName: `${pending.institutionName} - ${accountLabel}`,
        consentExpiresAt,
      });
    }

    settingsUrl.searchParams.set("connected", String(requisition.accounts.length));
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    settingsUrl.searchParams.set("bankSyncError", err instanceof Error ? err.message : "unknown");
    return NextResponse.redirect(settingsUrl);
  }
}
