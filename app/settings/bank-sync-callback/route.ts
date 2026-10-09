import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRequisition, getAccountMeta, PENDING_CONNECTION_COOKIE, type PendingConnection } from "@/lib/gocardless";
import { linkOrRenewBankAccount } from "@/lib/db/bank-sync";
import { resolveCurrentUser } from "@/lib/db/current-user";
import { runWithUserDb } from "@/lib/db/context";

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
    // This route is gated by middleware.ts (session cookie), not an auth()
    // check of its own - still resolves which account's encrypted file
    // linkOrRenewBankAccount below should write into.
    const { user, conn } = await resolveCurrentUser();
    if (user.id !== pending.userId) {
      // Someone else's pending connection, on a browser/session that isn't
      // theirs anymore (shared device, a second sign-in before the first
      // completed) - never apply bank data under the wrong account. Same
      // fixed code as a missing/corrupt cookie; the real reason goes to
      // the server log only, not the URL.
      console.error(`[bank-sync-callback] pending connection belongs to user ${pending.userId}, signed in as ${user.id}`);
      settingsUrl.searchParams.set("bankSyncError", "missing_state");
      return NextResponse.redirect(settingsUrl);
    }
    return await runWithUserDb(conn, async () => {
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
    });
  } catch (err) {
    // The underlying error can be GoCardless's own response body (see
    // gcFetch) - never put that in a URL the browser then carries around
    // (history, Referer headers, server logs). Full detail goes to this
    // process's own log; the user gets a fixed, safe code.
    console.error("[bank-sync-callback] linking failed:", err);
    settingsUrl.searchParams.set("bankSyncError", "link_failed");
    return NextResponse.redirect(settingsUrl);
  }
}
