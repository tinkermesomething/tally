"use client";

import { useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { formatPence } from "@/lib/money";
import { MONTH_ABBREVIATIONS } from "@/lib/months";
import { formatDueDate, type OverdueItem } from "@/lib/overdue";
import { useAppSettings } from "@/components/providers/app-settings-provider";

/** The red "Overdue" circle in a grid cell - click it to see exactly what's
 * overdue (which item, when it was due, how much is still unpaid), instead
 * of a bare icon with only a hover tooltip. */
export function OverdueAlert({
  items,
  year,
  month,
}: {
  items: OverdueItem[];
  year: number;
  month: number;
}) {
  const { currency } = useAppSettings();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex shrink-0 rounded-full"
        aria-label="Overdue - show details"
        title="Overdue - click for details"
      >
        <AlertCircle className="size-3.5 text-status-critical" />
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchorRef} align="end" sideOffset={4}>
            <PopoverPopup className="w-auto max-w-64">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Overdue</p>
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.name} className="text-sm">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-muted-foreground">
                        {item.dueDay !== null && ` - was due ${formatDueDate(item.dueDay, year, month, MONTH_ABBREVIATIONS)}`}
                        {item.amountPence !== undefined && `, ${formatPence(item.amountPence, currency)} still unpaid`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Tick it paid to clear this alert.</p>
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  );
}
