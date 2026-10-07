"use client";

import { useRef, useState, useTransition } from "react";
import { Anchor, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverPortal, PopoverPositioner } from "@/components/ui/popover";
import { SwatchRow, nativePickerActive } from "@/components/swatch-row";
import { archiveIncomeSource, moveIncomeSourceToIndex, renameIncomeSource, setIncomeColor, setPayAnchor } from "@/app/grid/actions";
import { InlineEditText } from "@/components/inline-edit-text";
import { useRowDrag } from "@/components/grid/use-row-drag";
import { runAction } from "@/lib/action-result";
import { cn } from "@/lib/utils";

export function IncomeSourceSettingsRow({
  id,
  name,
  isPayAnchor,
  color = null,
  fallbackColor = "var(--chart-1)",
}: {
  id: number;
  name: string;
  isPayAnchor: boolean;
  /** The colour chosen for this source's Grid row ("#rrggbb"), or null for automatic. */
  color?: string | null;
  /** The automatic colour shown when none is chosen (what the Grid uses). */
  fallbackColor?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const drag = useRowDrag((sourceId, toIndex) => moveIncomeSourceToIndex(sourceId, toIndex, new Date().getFullYear()));

  function save(next: string | null) {
    setError(null);
    startTransition(async () => {
      setError(await runAction(() => setIncomeColor(id, next)));
    });
  }

  return (
    <div
      className="flex items-center justify-between gap-2 row-card rounded-lg bg-card px-3 py-2"
      data-reorder-group="settings-income"
      data-reorder-id={id}
    >
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Colour of ${name} in the grid`}
          title="Choose this source's row colour in the Grid"
          data-testid="income-colour-dot"
          className="size-4 shrink-0 rounded-full border border-border transition-transform hover:scale-110"
          style={{ backgroundColor: color ?? fallbackColor }}
        />
        <Popover open={open} onOpenChange={(next) => { if (!next && nativePickerActive()) return; setOpen(next); }}>
          <PopoverPortal>
            <PopoverPositioner anchor={anchorRef} align="start" sideOffset={6}>
              <PopoverPopup className="max-w-[calc(100vw-1rem)]">
                <div className="min-w-0 space-y-2.5" data-testid="income-colour-panel">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Row colour in the Grid</span>
                    <button
                      type="button"
                      aria-pressed={color === null}
                      onClick={() => save(null)}
                      className={cn("rounded-md border px-2 py-0.5 text-xs", color === null ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                    >
                      Auto
                    </button>
                  </div>
                  <SwatchRow value={color ?? ""} onChange={(c) => save(c)} label="Income colour" />
                  <p className="text-xs text-muted-foreground">Auto uses the next colour in the palette.</p>
                  {error && <p className="text-xs text-status-critical">{error}</p>}
                </div>
              </PopoverPopup>
            </PopoverPositioner>
          </PopoverPortal>
        </Popover>
        <span
          onPointerDown={(e) => drag.onPointerDown(e, "settings-income", id)}
          title="Press and hold to drag this income source up or down"
          className="min-w-0"
        >
          <InlineEditText value={name} onCommit={(next) => renameIncomeSource(id, next)} className="font-medium" />
        </span>
        {drag.error && (
          <span role="alert" className="text-xs text-status-critical">
            {drag.error}
          </span>
        )}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => setPayAnchor(isPayAnchor ? null : id))}
          title={
            isPayAnchor
              ? "This source sets the budget month for expenses logged from now on - click to unset"
              : "Make this the pay anchor: logging an entry here lets you pick which budget month it (and everything logged after it) counts toward"
          }
          className={
            isPayAnchor
              ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.65rem] text-primary"
              : "shrink-0 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:border-muted-foreground"
          }
        >
          <Anchor className="size-3" />
          {isPayAnchor ? "Pay anchor" : "Set as pay anchor"}
        </button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title="Archive"
          onClick={() => startTransition(() => archiveIncomeSource(id))}
        >
          <Archive className="size-3.5 text-chart-2" />
        </Button>
      </div>
    </div>
  );
}
