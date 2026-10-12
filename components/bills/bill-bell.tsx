"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { cn } from "@/lib/utils";
import type { BillWithStatus } from "@/lib/db/bills";

/** In-app only, no email/push - a dropdown of bills due soon or overdue
 * (same "due soon" threshold the expiring-bank-connection badge in
 * UserMenu already uses). Fetched once by app-header.tsx, same pattern as
 * pendingCount/expiringBankAccounts - not a live poll. */
export function BillBell({ bills }: { bills: BillWithStatus[] }) {
  const { currency, dateFormat } = useAppSettings();
  const overdueCount = bills.filter((b) => b.daysUntilDue < 0).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className="relative flex items-center rounded-md p-1.5 text-foreground transition-colors hover:bg-accent" title="Bills due soon">
            <Bell className="size-4" />
            {bills.length > 0 && (
              <span
                className={cn(
                  "absolute -top-0.5 -right-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[0.6rem] font-semibold text-white",
                  overdueCount > 0 ? "bg-status-critical" : "bg-status-warning"
                )}
              >
                {bills.length}
              </span>
            )}
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        {bills.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing due soon.</p>
        ) : (
          bills.map((b) => (
            <DropdownMenuItem key={b.id} render={<Link href="/bills" />} className="flex-col items-start gap-0">
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium">{b.name}</span>
                <span className={cn("text-xs font-medium", b.daysUntilDue < 0 ? "text-status-critical" : "text-status-warning")}>
                  {b.daysUntilDue < 0 ? `${Math.abs(b.daysUntilDue)}d overdue` : b.daysUntilDue === 0 ? "Today" : `in ${b.daysUntilDue}d`}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {formatPence(b.amountPence, currency)} · {formatDate(b.nextDueDate, dateFormat)}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
