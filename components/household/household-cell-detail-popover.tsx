"use client";

import { useEffect, useState } from "react";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { getHouseholdCellDetailAction } from "@/app/household/actions";
import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { MONTH_NAMES } from "@/lib/months";
import type { HouseholdCellDetail } from "@/lib/db/household";

/** "£450 combined" alone hides who actually spent it - fetched on demand
 * (not baked into the grid's own initial load, which would mean a query
 * per cell nobody asked to see yet) when a cell is clicked. */
export function HouseholdCellDetailPopover({
  categoryName,
  year,
  month,
  anchor,
  onClose,
}: {
  categoryName: string;
  year: number;
  month: number;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const { currency } = useAppSettings();
  const [detail, setDetail] = useState<HouseholdCellDetail | null>(null);

  useEffect(() => {
    let live = true;
    getHouseholdCellDetailAction(categoryName, year, month).then((d) => {
      if (live) setDetail(d);
    });
    return () => {
      live = false;
    };
  }, [categoryName, year, month]);

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverPortal>
        <PopoverPositioner anchor={anchor} align="center" sideOffset={6}>
          <PopoverPopup>
            <p className="mb-2 text-sm font-medium">
              {categoryName} · {MONTH_NAMES[month - 1]} {year}
            </p>
            {!detail ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : detail.budgeted.length === 0 && detail.spent.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing here.</p>
            ) : (
              <div className="space-y-3">
                {detail.budgeted.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Budgeted</p>
                    <ul className="space-y-1 text-sm">
                      {detail.budgeted.map((b, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <span>{b.sourceUserName ?? "Someone"}</span>
                          <span className="tabular-nums">{formatPence(b.amountPence, currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {detail.spent.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Spent</p>
                    <ul className="space-y-1 text-sm">
                      {detail.spent.map((s, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">
                            {s.sourceUserName ?? "Someone"}
                            {s.note ? ` · ${s.note}` : ""}
                          </span>
                          <span className="shrink-0 tabular-nums">{formatPence(s.amountPence, currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
