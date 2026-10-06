"use client";

import { PRIDE_FLAGS, RGB_COLORS, flowGradient, type PrideFlag } from "@/lib/savings-math";
import { SwatchRow } from "@/components/swatch-row";
import { cn } from "@/lib/utils";

export type SpecialValue = { name: "rgb" | PrideFlag; main?: string } | null;

/** The value string for a special, with its optional static main colour. */
export const specialString = (name: "rgb" | PrideFlag, main?: string) => `special:${name}${main ? `|${main}` : ""}`;

/** Choose a SPECIAL: animated RGB or one of seven unnamed colour combinations.
 * Every special flows (smoothly blended, always moving). Under them, an
 * optional static MAIN colour for text, outlines and tints - the animation
 * stays on borders, stripes and bars. Shared by the accent picker and the
 * savings bucket colour picker. */
export function SpecialPicker({ value, onChange }: { value: SpecialValue; onChange: (next: string) => void }) {
  const names = Object.keys(PRIDE_FLAGS) as PrideFlag[];
  const current = value?.name ?? "rgb";
  const main = value?.main;

  return (
    <div className="space-y-2.5" role="group" aria-label="Special colours">
      <button
        type="button"
        aria-pressed={value?.name === "rgb"}
        onClick={() => onChange(specialString("rgb", main))}
        className={cn("flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 text-left text-sm", value?.name === "rgb" ? "border-foreground" : "border-border hover:border-muted-foreground")}
      >
        <span className="bucket-rgb h-3 w-16 shrink-0 rounded-full" style={{ backgroundImage: flowGradient(RGB_COLORS) }} aria-hidden />
        RGB
      </button>
      <div className="grid grid-cols-4 gap-2">
        {names.map((flag, i) => {
          const selected = value?.name === flag;
          return (
            <button
              key={flag}
              type="button"
              aria-pressed={selected}
              aria-label={`Colour combination ${i + 1}`}
              onClick={() => onChange(specialString(flag, main))}
              className={cn("bucket-rgb h-7 rounded-md border-2 bg-clip-padding transition-transform hover:scale-105", selected ? "border-foreground" : "border-border")}
              style={{ backgroundImage: flowGradient(PRIDE_FLAGS[flag].colors) }}
            />
          );
        })}
      </div>

      <div className="space-y-1" data-testid="special-main">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Main colour (optional)</span>
          <button
            type="button"
            aria-pressed={!main}
            onClick={() => onChange(specialString(current))}
            className={cn("rounded-md border px-2 py-0.5 text-xs", !main ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            Auto
          </button>
        </div>
        <SwatchRow value={main ?? ""} onChange={(c) => onChange(specialString(current, c))} label="Main colour" />
        <p className="text-xs text-muted-foreground">Used for text and outlines. The animation stays on borders.</p>
      </div>
    </div>
  );
}
