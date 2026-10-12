"use client";

import { useTransition } from "react";
import { Archive, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BillDialog } from "@/components/bills/bill-dialog";
import { markPaid, removeBill } from "@/app/bills/actions";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { cn } from "@/lib/utils";
import type { BillWithStatus } from "@/lib/db/bills";

function dueLabel(daysUntilDue: number): { text: string; tone: "critical" | "warn" | "neutral" } {
  if (daysUntilDue < 0) return { text: `${Math.abs(daysUntilDue)}d overdue`, tone: "critical" };
  if (daysUntilDue === 0) return { text: "Due today", tone: "warn" };
  if (daysUntilDue <= 7) return { text: `Due in ${daysUntilDue}d`, tone: "warn" };
  return { text: `Due in ${daysUntilDue}d`, tone: "neutral" };
}

export function BillRow({ bill, categories }: { bill: BillWithStatus; categories: { id: number; name: string }[] }) {
  const { currency, dateFormat } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const due = dueLabel(bill.daysUntilDue);

  return (
    <div className="flex items-center justify-between gap-2 row-card rounded-lg bg-card px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{bill.name}</span>
        <span className="text-xs text-muted-foreground">
          {formatPence(bill.amountPence, currency)} · {formatDate(bill.nextDueDate, dateFormat)}
          {bill.categoryName && !bill.synthetic ? ` · ${bill.categoryName}` : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            due.tone === "critical" && "bg-status-critical/15 text-status-critical",
            due.tone === "warn" && "bg-status-warning/15 text-status-warning",
            due.tone === "neutral" && "text-muted-foreground"
          )}
        >
          {due.text}
        </span>
        {bill.synthetic ? (
          // Nothing real to act on here - paying happens on the Grid
          // (logging an expense, or ticking the cell paid), the due day
          // itself is edited in Settings > Categories. Both already exist;
          // duplicating "mark paid"/"edit" for a derived row would just be
          // a second, easy-to-miss place that can drift from the real one.
          <span className="px-1 text-xs text-muted-foreground" title="From a category's due day - paid and edited on the Budget page">
            from your categories
          </span>
        ) : (
          <>
            <Button size="icon-xs" variant="ghost" disabled={pending} title="Mark paid now" onClick={() => startTransition(() => markPaid(bill.id))}>
              <Check className="size-3.5 text-status-good" />
            </Button>
            <BillDialog
              categories={categories}
              bill={bill}
              trigger={
                <Button size="icon-xs" variant="ghost" title="Edit">
                  <Pencil className="size-3.5" />
                </Button>
              }
            />
            <Button size="icon-xs" variant="ghost" disabled={pending} title="Archive" onClick={() => startTransition(() => removeBill(bill.id))}>
              <Archive className="size-3.5 text-chart-2" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
