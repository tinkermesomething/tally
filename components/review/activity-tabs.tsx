"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export type ActivityTab = "pending" | "logged";

/** "To review" / "Logged" - one nav item's worth of page, kept in the URL
 * (?tab=) same as ReportViewToggle's ?view=, so a reload or a shared link
 * lands on the same tab. Each tab owns its own filters (from/to for
 * pending, year/month for logged) - switching tabs intentionally doesn't
 * carry those over, they mean different things on each side. */
export function ActivityTabs({ tab, pendingCount }: { tab: ActivityTab; pendingCount: number }) {
  const router = useRouter();
  const tabs: { id: ActivityTab; label: string }[] = [
    { id: "pending", label: "To review" },
    { id: "logged", label: "Logged" },
  ];
  return (
    <div role="group" aria-label="Activity view" className="inline-flex shrink-0 rounded-lg border border-input bg-muted/40 p-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tab === t.id}
          onClick={() => router.push(`/review?tab=${t.id}`)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm transition-colors",
            tab === t.id ? "accent-outline font-medium" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
          {t.id === "pending" && pendingCount > 0 && (
            <span className="flex min-w-[1.1rem] items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground">
              {pendingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
