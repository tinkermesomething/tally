import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRequisition, getAccountMeta, PENDING_CONNECTION_COOKIE, type PendingConnection } from "@/lib/gocardless";
import { linkOrRenewBankAccount } from "@/lib/db/bank-sync";

// Where GoCardless (or the end-user's bank) redirects back to after the
// consent step. No query params from that redirect are trusted - see
// PENDING_CONNECTION_COOKIE's comment - all correlation state comes from
// the httpOnly cookie startBankConnection set before sending the user away.
export async function GET() {
  // NOT `new URL("...", request.url)` - request.url's origin resolved to
  // the standalone server's own bind address (0.0.0.0:3000, from the
  // Dockerfile's HOSTNAME/PORT) rather than the real public hostname, a
  // real bug caught live: GoCardless's redirect landed the browser on
  // literally "https://0.0.0.0:3000/settings?...". AUTH_TRUST_HOST only
  // covers Auth.js's own routes, not a plain Route Handler's request.url.
  // GOCARDLESS_REDIRECT_URL is the one value here that's guaranteed to be
  // the real external origin, since it has to be for GoCardless's own
  // redirect to work at all.
  const redirectUrl = process.env.GOCARDLESS_REDIRECT_URL;
  if (!redirectUrl) throw new Error("GOCARDLESS_REDIRECT_URL is not configured.");
  const settingsUrl = new URL("/settings?tab=bank-sync", new URL(redirectUrl).origin);

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
