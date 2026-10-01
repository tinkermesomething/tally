import Link from "next/link";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccentPicker } from "@/components/accent-picker";
import { Button } from "@/components/ui/button";
import { getPendingTransactions, getBankAccounts } from "@/lib/db/bank-sync";

const NAV_ITEMS = [
  { href: "/grid", label: "Budget" },
  { href: "/entries", label: "Entries" },
  { href: "/review", label: "Review" },
  { href: "/debt", label: "Debt" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
] as const;

// Same threshold bank-account-settings-row.tsx uses for its own "Expires in
// Nd" warning badge - a connection this close to lapsing (or already
// lapsed) is the actionable case, not every account regardless of how much
// runway it has left.
const EXPIRY_WARNING_DAYS = 14;

export async function AppHeader() {
  const session = await auth();
  // Cheap enough at this app's scale to run on every request, same as the
  // auth() check above it - no separate count-only query needed yet.
  const pendingCount = session ? (await getPendingTransactions()).length : 0;
  // Nothing else in the app proactively surfaces an expiring/expired bank
  // connection - without this, sync just silently stops producing new
  // transactions and nobody notices until they go looking. Settings is
  // where reconnecting actually happens, so the badge lives there.
  const expiringBankAccounts = session
    ? (await getBankAccounts()).filter(
        (a) => (a.consentExpiresAt.getTime() - Date.now()) / 86_400_000 <= EXPIRY_WARNING_DAYS
      ).length
    : 0;

  return (
    <header className="sticky top-0 z-30 bg-background/95 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/60">
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
