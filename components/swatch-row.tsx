"use client";

import { Check } from "lucide-react";
import { BUCKET_COLORS, HEX_COLOR } from "@/lib/savings-math";
import { cn } from "@/lib/utils";

// Opening the native colour window moves focus out of the page, which made the
// host popover/dialog close and unmount the input - so the pick made in the
// native window had nowhere to land. Hosts ask this before honouring a close.
let pickerFocused = false;
let pickerReleasedAt = 0;
const PICKER_GRACE_MS = 600;

export function nativePickerActive(): boolean {
  return pickerFocused || Date.now() - pickerReleasedAt < PICKER_GRACE_MS;
}

const NAMES = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"];

/** A single colour: palette swatches plus any colour you like. */
export function SwatchRow({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const custom = HEX_COLOR.test(value) && !BUCKET_COLORS.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {BUCKET_COLORS.map((c, i) => {
        const selected = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${NAMES[i]}`}
            aria-pressed={selected}
            onClick={() => onChange(c)}
            className={cn("flex size-6 items-center justify-center rounded-full border-2 transition-transform hover:scale-110", selected ? "border-foreground" : "border-transparent")}
            style={{ backgroundColor: c }}
          >
            {selected && <Check className="size-3.5 text-white" />}
          </button>
        );
      })}
      <label
        className={cn("flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2", custom ? "border-foreground" : "border-dashed border-muted-foreground/50")}
        title="Pick any colour"
      >
        <input
          type="color"
          aria-label={`${label} custom`}
          value={HEX_COLOR.test(value) ? value : "#2a78d6"}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { pickerFocused = true; }}
          onBlur={() => { pickerFocused = false; pickerReleasedAt = Date.now(); }}
          className="size-8 shrink-0 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
    </div>
  );
}

