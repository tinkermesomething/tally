"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { REPORT_VIEWS, type ReportView } from "@/lib/report-view";

/** Budgeted / Spent / Compare - kept in the URL (?view=) so a reload or a
 * shared link shows the same view, and so the year and month pickers keep it. */
export function ReportViewToggle({ view, year, month }: { view: ReportView; year: number; month: string }) {
  const router = useRouter();
  return (
    <div role="group" aria-label="Report view" className="inline-flex rounded-lg border border-input bg-muted/40 p-0.5">
      {REPORT_VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={view === v.id}
          onClick={() => router.push(`/reports?${new URLSearchParams({ year: String(year), month, view: v.id })}`)}
          className={cn(
            "rounded-md border border-transparent px-3 py-1 text-sm transition-colors",
            view === v.id ? "accent-outline font-medium" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
