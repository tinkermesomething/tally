import type { LucideIcon } from "lucide-react";
import { HelpTip } from "@/components/help-tip";
import type { HelpId } from "@/lib/help/content";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  help,
  className,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "neutral" | "good" | "critical";
  /** Adds a ? next to the label that explains it. */
  help?: HelpId;
  /** Overrides the default `w-fit` sizing - e.g. the grid page passes a
   * fixed/equal width so its 4 pills line up on mobile instead of each
   * sizing to its own label+value length. */
  className?: string;
}) {
  return (
    <div className={cn("inline-flex w-fit items-center gap-3 rounded-full border border-border bg-card py-2 pr-5 pl-2 shadow-sm", className)}>
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
      {help && <HelpTip id={help} />}
      <span className="text-sm font-semibold tabular-nums tracking-tight">{value}</span>
    </div>
  );
}
