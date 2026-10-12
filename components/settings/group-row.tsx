"use client";

import { useRef, useState, useTransition } from "react";
import { Popover, PopoverPopup, PopoverPortal, PopoverPositioner } from "@/components/ui/popover";
import { SwatchRow, nativePickerActive } from "@/components/swatch-row";
import { InlineEditText } from "@/components/inline-edit-text";
import { renameGroupAction, setGroupColorAction } from "@/app/settings/groups/actions";
import { cn } from "@/lib/utils";

/** One row per distinct group name currently in use by an active category
 * (lib/group-colors.ts/getCategoryTree) - groups aren't a stored entity,
 * so there's no id here, just the name itself (which both actions key
 * off). `color` is already resolved (stored override if one exists, else
 * the same auto-palette-by-order colour /grid and /reports use), `custom`
 * says which so "Auto" can tell whether there's an override to clear. */
export function GroupRow({ name, color, custom }: { name: string; color: string; custom: boolean }) {
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  function saveColor(next: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await setGroupColorAction(name, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save that colour.");
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
          aria-label={`Colour of ${name}`}
          title="Choose this group's colour"
          className="size-4 shrink-0 rounded-full border border-border transition-transform hover:scale-110"
          style={{ backgroundColor: color }}
        />
        <Popover open={open} onOpenChange={(next) => { if (!next && nativePickerActive()) return; setOpen(next); }}>
          <PopoverPortal>
            <PopoverPositioner anchor={anchorRef} align="start" sideOffset={6}>
              <PopoverPopup className="max-w-[calc(100vw-1rem)]">
                <div className="min-w-0 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Group colour</span>
                    <button
                      type="button"
                      aria-pressed={!custom}
                      onClick={() => saveColor(null)}
                      className={cn("rounded-md border px-2 py-0.5 text-xs", !custom ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                    >
                      Auto
                    </button>
                  </div>
                  <SwatchRow value={color} onChange={(c) => saveColor(c)} label={`${name}'s colour`} />
                  <p className="text-xs text-muted-foreground">Auto uses the next colour in the palette, by the order groups first appear.</p>
                  {error && <p className="text-xs text-status-critical">{error}</p>}
                </div>
              </PopoverPopup>
            </PopoverPositioner>
          </PopoverPortal>
        </Popover>
        <InlineEditText value={name} onCommit={(next) => renameGroupAction(name, next)} className="font-medium" />
      </span>
    </div>
  );
}
