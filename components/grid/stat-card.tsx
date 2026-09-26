import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "neutral" | "good" | "critical";
}) {
  return (
    <div className="inline-flex w-fit items-center gap-3 rounded-full border border-border bg-card py-2 pr-5 pl-2 shadow-sm">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          tone === "good" && "bg-status-good/15 text-status-good",
          tone === "critical" && "bg-status-critical/15 text-status-critical",
          tone === "neutral" && "bg-primary/15 text-primary"
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums tracking-tight">{value}</span>
    </div>
  );
}
