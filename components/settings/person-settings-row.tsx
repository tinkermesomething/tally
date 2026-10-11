"use client";

import { useRef, useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverPortal, PopoverPositioner } from "@/components/ui/popover";
import { SwatchRow, nativePickerActive } from "@/components/swatch-row";
import { InlineEditText } from "@/components/inline-edit-text";
import { removePerson, renamePerson, setPersonColor } from "@/app/debt/actions";
import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { cn } from "@/lib/utils";
import type { PersonWithBalance } from "@/lib/db/debt";

export function PersonSettingsRow({
  person,
  fallbackColor = "var(--chart-1)",
}: {
  person: PersonWithBalance;
  /** The automatic colour shown when none is chosen - same convention as
   * IncomeSourceSettingsRow's fallbackColor (a palette colour picked by
   * this row's position, passed down from the list). */
  fallbackColor?: string;
}) {
  const { currency } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  function saveColor(next: string | null) {
    setColorError(null);
    startTransition(async () => {
      try {
        await setPersonColor(person.id, next);
      } catch (err) {
        setColorError(err instanceof Error ? err.message : "Couldn't save that colour.");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-2 row-card rounded-lg bg-card px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Colour of ${person.name} in the debt chart`}
          title="Choose their colour in the debt chart"
          data-testid="person-colour-dot"
          className="size-4 shrink-0 rounded-full border border-border transition-transform hover:scale-110"
          style={{ backgroundColor: person.color ?? fallbackColor }}
        />
        <Popover open={open} onOpenChange={(next) => { if (!next && nativePickerActive()) return; setOpen(next); }}>
          <PopoverPortal>
            <PopoverPositioner anchor={anchorRef} align="start" sideOffset={6}>
              <PopoverPopup className="max-w-[calc(100vw-1rem)]">
                <div className="min-w-0 space-y-2.5" data-testid="person-colour-panel">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Colour in the debt chart</span>
                    <button
                      type="button"
                      aria-pressed={person.color === null}
                      onClick={() => saveColor(null)}
                      className={cn("rounded-md border px-2 py-0.5 text-xs", person.color === null ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                    >
                      Auto
                    </button>
                  </div>
                  <SwatchRow value={person.color ?? ""} onChange={(c) => saveColor(c)} label={`${person.name}'s colour`} />
                  <p className="text-xs text-muted-foreground">Auto uses the next colour in the palette.</p>
                  {colorError && <p className="text-xs text-status-critical">{colorError}</p>}
                </div>
              </PopoverPopup>
            </PopoverPositioner>
          </PopoverPortal>
        </Popover>
        <div className="flex min-w-0 flex-col">
          <InlineEditText value={person.name} onCommit={(next) => renamePerson(person.id, next)} className="font-medium" />
          {person.balancePence !== 0 && (
            <span
              className={cn(
                "px-1 text-xs tabular-nums",
                person.balancePence > 0 ? "text-status-critical" : "text-status-good"
              )}
            >
              {person.balancePence > 0
                ? `You owe ${formatPence(person.balancePence, currency)}`
                : `Owed to you ${formatPence(-person.balancePence, currency)}`}
            </span>
          )}
        </div>
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        title="Archive"
        onClick={() => startTransition(() => removePerson(person.id))}
      >
        <Archive className="size-3.5 text-chart-2" />
      </Button>
    </div>
  );
}
