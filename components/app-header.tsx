import Link from "next/link";
import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { AccentPicker } from "@/components/accent-picker";
import { UserMenu } from "@/components/user-menu";
import { BillBell } from "@/components/bills/bill-bell";
import { Button } from "@/components/ui/button";
import { getPendingTransactions, getBankAccounts } from "@/lib/db/bank-sync";
import { getUpcomingBills, type BillWithStatus } from "@/lib/db/bills";
import { getAppSettings } from "@/lib/db/settings";
import { isHouseholdEnabled } from "@/lib/db/household";
import { withCurrentUser } from "@/lib/db/current-user";
import type { UserRow } from "@/lib/db/users";

// Same threshold as EXPIRY_WARNING_DAYS below - "due soon" for a bill gets
// the same runway as "about to lapse" for a bank connection.
const BILL_DUE_SOON_DAYS = 14;

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

// Settings isn't in this list - it's reached from the user menu instead
// (components/user-menu.tsx), not the main nav. labelKey is a key into
// messages/*.json's "nav" namespace (see i18n/request.ts) - the proof-of-
// concept slice of this app translated so far; everything else still
// reads from plain English strings in their own components, same as
// before - that's the explicitly-deferred "ongoing work."
const NAV_ITEMS = [
  { href: "/grid", labelKey: "budget" },
  { href: "/household", labelKey: "household" },
  { href: "/debt", labelKey: "debts" },
  { href: "/savings", labelKey: "savings" },
  { href: "/net-worth", labelKey: "netWorth" },
  { href: "/bills", labelKey: "bills" },
  { href: "/reports", labelKey: "reports" },
  { href: "/review", labelKey: "review" },
  { href: "/entries", labelKey: "entries" },
] as const;

// Same threshold bank-account-settings-row.tsx uses for its own "Expires in
// Nd" warning badge - a connection this close to lapsing (or already
// lapsed) is the actionable case, not every account regardless of how much
// runway it has left.
const EXPIRY_WARNING_DAYS = 14;

export async function AppHeader() {
  // Rendered as its own component inside the root layout's JSX, not called
  // directly from layout's own function body - gets its own connection
  // rather than assume the layout's already-established one reaches here
  // (unverified whether it would; explicit is cheap and always correct).
  // No session yet (e.g. /signin) means no account to resolve one for -
  // nothing below reads the database in that case anyway (see the `session
  // ? ... : 0` guards).
  const session = await auth();
  const t = await getTranslations("nav");
  // A session that decrypts fine but names an account that no longer
  // resolves (disabled, deleted, or - once, moving off the old single-user
  // login - never linked at all) must not take the Sign out button down
  // with it; that button is the only way out of a broken session short of
  // clearing cookies by hand. Nav/badges just show nothing in that case,
  // same as being signed out.
  let pendingCount = 0;
  let expiringBankAccounts = 0;
  let upcomingBills: BillWithStatus[] = [];
  // Default to showing both - only hidden once a resolved user's own
  // settings say to, same "nothing hidden on a resolution failure" stance
  // as every other badge below.
  let showDebtTab = true;
  let showNetWorthTab = true;
  // Unlike the two above, defaults to HIDDEN, not shown - this is
  // instance-wide (admin-controlled, see Settings > Admin), and a
  // resolution failure is the wrong moment to fail open on a tab that
  // surfaces OTHER people's shared data.
  let householdOn = false;
  // Returned from the closure rather than assigned to an outer `let` from
  // inside it - TypeScript's narrowing doesn't track a reassignment made
  // inside a nested callback, so `currentUser` read after this block would
  // otherwise still type as `null` at every later usage (confirmed by
  // tsc, not a style preference).
  let currentUser: UserRow | null = null;
  if (session) {
    try {
      const result = await withCurrentUser(async (user) => {
        // Cheap enough at this app's scale to run on every request, same
        // as the auth() check above it - no separate count-only query
        // needed yet.
        const pending = (await getPendingTransactions()).length;
        // Nothing else in the app proactively surfaces an expiring/expired
        // bank connection - without this, sync just silently stops
        // producing new transactions and nobody notices until they go
        // looking. Settings is where reconnecting actually happens, so the
        // badge lives there.
        const expiring = (await getBankAccounts()).filter(
          (a) => (a.consentExpiresAt.getTime() - Date.now()) / 86_400_000 <= EXPIRY_WARNING_DAYS
        ).length;
        const bills = await getUpcomingBills(BILL_DUE_SOON_DAYS);
        const settings = await getAppSettings();
        const household = await isHouseholdEnabled();
        return { user, pending, expiring, bills, settings, household };
      });
      currentUser = result.user;
      pendingCount = result.pending;
      expiringBankAccounts = result.expiring;
      upcomingBills = result.bills;
      showDebtTab = result.settings.showDebtTab;
      showNetWorthTab = result.settings.showNetWorthTab;
      householdOn = result.household;
    } catch (err) {
      console.error("[app-header] session doesn't resolve to a real account:", err);
    }
  }

  return (
    <header className="sticky top-0 z-30 bg-background/95 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/60 print:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/grid" className="font-semibold tracking-tight">
          Tally
        </Link>
        {session && (
          <>
            {/* min-w-0 is load-bearing: a flex-1 child won't actually
                shrink below its content's natural width (and so won't
                scroll) without it - the classic flexbox overflow gotcha.
                Without this, 6 full-width nav labels on a phone pushed
                AccentPicker/UserMenu off the right edge of the header
                entirely (not hidden - genuinely unreachable, no way to
                get to Settings or sign out from mobile). Scrollbar hidden
                for a tab-bar look; the row still scrolls by touch/drag. */}
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {NAV_ITEMS.filter(
                (item) =>
                  (item.href !== "/debt" || showDebtTab) &&
                  (item.href !== "/net-worth" || showNetWorthTab) &&
                  (item.href !== "/household" || householdOn)
              ).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {t(item.labelKey)}
                  {item.href === "/review" && pendingCount > 0 && (
                    <span className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <AccentPicker />
              <BillBell bills={upcomingBills} />
              {currentUser ? (
                <UserMenu
                  userId={currentUser.id}
                  name={currentUser.name}
                  email={currentUser.email}
                  color={currentUser.avatarColor}
                  imageVersion={currentUser.avatarImageUpdatedAt ? currentUser.avatarImageUpdatedAt.getTime() : null}
                  expiringBankAccounts={expiringBankAccounts}
                  onSignOut={signOutAction}
                />
              ) : (
                // currentUser failed to resolve (see the catch above) but the
                // session cookie itself is still present - sign-out is the
                // only way out of that short of clearing cookies by hand, so
                // it has to survive independently of session resolution
                // succeeding, not live only inside UserMenu.
                <form action={signOutAction}>
                  <Button type="submit" size="icon-sm" variant="ghost" title="Sign out">
                    <LogOut className="size-4" />
                  </Button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
