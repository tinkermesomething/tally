import Link from "next/link";
import { auth, signOut } from "@/auth";
import { AccentPicker } from "@/components/accent-picker";
import { UserMenu } from "@/components/user-menu";
import { getPendingTransactions, getBankAccounts } from "@/lib/db/bank-sync";
import { withCurrentUser } from "@/lib/db/current-user";
import type { UserRow } from "@/lib/db/users";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/signin" });
}

// Settings isn't in this list - it's reached from the user menu instead
// (components/user-menu.tsx), not the main nav.
const NAV_ITEMS = [
  { href: "/grid", label: "Budget" },
  { href: "/debt", label: "Debt" },
  { href: "/savings", label: "Savings" },
  { href: "/reports", label: "Reports" },
  { href: "/review", label: "Review" },
  { href: "/entries", label: "Entries" },
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
  // A session that decrypts fine but names an account that no longer
  // resolves (disabled, deleted, or - once, moving off the old single-user
  // login - never linked at all) must not take the Sign out button down
  // with it; that button is the only way out of a broken session short of
  // clearing cookies by hand. Nav/badges just show nothing in that case,
  // same as being signed out.
  let pendingCount = 0;
  let expiringBankAccounts = 0;
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
        return { user, pending, expiring };
      });
      currentUser = result.user;
      pendingCount = result.pending;
      expiringBankAccounts = result.expiring;
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
            <nav className="flex flex-1 items-center gap-1 text-sm">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {item.label}
                  {item.href === "/review" && pendingCount > 0 && (
                    <span className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
            <AccentPicker />
            {currentUser && (
              <UserMenu
                userId={currentUser.id}
                name={currentUser.name}
                email={currentUser.email}
                color={currentUser.avatarColor}
                imageVersion={currentUser.avatarImageUpdatedAt ? currentUser.avatarImageUpdatedAt.getTime() : null}
                expiringBankAccounts={expiringBankAccounts}
                onSignOut={signOutAction}
              />
            )}
          </>
        )}
      </div>
    </header>
  );
}
