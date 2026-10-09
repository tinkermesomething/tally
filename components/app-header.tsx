import Link from "next/link";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccentPicker } from "@/components/accent-picker";
import { Button } from "@/components/ui/button";
import { getPendingTransactions, getBankAccounts } from "@/lib/db/bank-sync";
import { withCurrentUser } from "@/lib/db/current-user";

const NAV_ITEMS = [
  { href: "/grid", label: "Budget" },
  { href: "/debt", label: "Debt" },
  { href: "/savings", label: "Savings" },
  { href: "/reports", label: "Reports" },
  { href: "/review", label: "Review" },
  { href: "/entries", label: "Entries" },
  { href: "/settings", label: "Settings" },
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
  if (session) {
    try {
      await withCurrentUser(async () => {
        // Cheap enough at this app's scale to run on every request, same
        // as the auth() check above it - no separate count-only query
        // needed yet.
        pendingCount = (await getPendingTransactions()).length;
        // Nothing else in the app proactively surfaces an expiring/expired
        // bank connection - without this, sync just silently stops
        // producing new transactions and nobody notices until they go
        // looking. Settings is where reconnecting actually happens, so the
        // badge lives there.
        expiringBankAccounts = (await getBankAccounts()).filter(
          (a) => (a.consentExpiresAt.getTime() - Date.now()) / 86_400_000 <= EXPIRY_WARNING_DAYS
        ).length;
      });
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
                  {item.href === "/settings" && expiringBankAccounts > 0 && (
                    <span
                      title="Bank connection expiring or expired - reconnect in Bank sync"
                      className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-status-critical px-1 text-[0.65rem] font-semibold text-white"
                    >
                      {expiringBankAccounts}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
            <AccentPicker />
            <ThemeToggle />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <Button type="submit" size="icon-sm" variant="ghost" title="Sign out">
                <LogOut className="size-4" />
              </Button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
