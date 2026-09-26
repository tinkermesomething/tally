import { formatPence } from "@/lib/money";
import { cn } from "@/lib/utils";

export function MobileSummaryBar({
  subtotal,
  wages,
  available,
  remaining,
}: {
  subtotal: number;
  wages: number;
  available: number;
  remaining: number;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-2 grid grid-cols-4 gap-px border-t border-border bg-border px-4 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <SummaryCell label="Spent" value={formatPence(subtotal)} />
      <SummaryCell label="Income" value={formatPence(wages)} />
      <SummaryCell
        label="Available"
        value={formatPence(available)}
        tone={available < 0 ? "critical" : "good"}
      />
      <SummaryCell
        label="Left to pay"
        value={formatPence(remaining)}
        tone={remaining > 0 ? "critical" : "good"}
      />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "critical";
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 bg-background py-2 text-center">
      <span className="text-[0.65rem] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-xs font-bold tabular-nums",
          tone === "critical" && "text-status-critical",
          tone === "good" && "text-status-good"
        )}
      >
        {value}
      </span>
    </div>
  );
}
