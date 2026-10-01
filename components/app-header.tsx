import Link from "next/link";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccentPicker } from "@/components/accent-picker";
import { Button } from "@/components/ui/button";
import { getPendingTransactions } from "@/lib/db/bank-sync";

const NAV_ITEMS = [
  { href: "/grid", label: "Budget" },
  { href: "/entries", label: "Entries" },
  { href: "/review", label: "Review" },
  { href: "/debt", label: "Debt" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
] as const;

export async function AppHeader() {
  const session = await auth();
  // Cheap enough at this app's scale to run on every request, same as the
  // auth() check above it - no separate count-only query needed yet.
  const pendingCount = session ? (await getPendingTransactions()).length : 0;

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
