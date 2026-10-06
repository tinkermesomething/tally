"use client";

import { bucketPaint, parseBucketColor } from "@/lib/savings-math";
import { SpecialPicker } from "@/components/special-picker";
import { SwatchRow } from "@/components/swatch-row";
import { cn } from "@/lib/utils";

type Mode = "auto" | "solid" | "duo" | "special";

const MODES: { id: Mode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "solid", label: "One colour" },
  { id: "duo", label: "Two colours" },
  { id: "special", label: "Special" },
];

/** Picks how a bucket is coloured. `value` is the stored text: "" (auto),
 * "#rrggbb", "#rrggbb,#rrggbb", "special:rgb" or "special:<pride flag>". */
export function ColourPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const spec = parseBucketColor(value) ?? { kind: "auto" as const };
  const mode: Mode = spec.kind === "auto" ? "auto" : spec.kind === "solid" ? "solid" : spec.kind === "duo" ? "duo" : "special";
  const first = spec.kind === "solid" ? spec.color : spec.kind === "duo" ? spec.colors[0] : "#2a78d6";
  const second = spec.kind === "duo" ? spec.colors[1] : "#eb6834";

  function chooseMode(next: Mode) {
    if (next === "auto") onChange("");
    else if (next === "solid") onChange(first);
    else if (next === "duo") onChange(`${first},${second}`);
    else onChange("special:rgb");
  }

  const preview = bucketPaint({ id: 1, color: value || null });

  return (
    <div className="space-y-2.5">
      <div role="group" aria-label="Colour style" className="inline-flex rounded-lg border border-input bg-muted/40 p-0.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => chooseMode(m.id)}
            className={cn("rounded-md border border-transparent px-2.5 py-1 text-xs transition-colors", mode === m.id ? "accent-outline font-medium" : "text-muted-foreground hover:text-foreground")}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "solid" && <SwatchRow value={first} onChange={(c) => onChange(c)} label="Colour" />}

      {mode === "duo" && (
        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">First colour</span>
            <SwatchRow value={first} onChange={(c) => onChange(`${c},${second}`)} label="First colour" />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Second colour</span>
            <SwatchRow value={second} onChange={(c) => onChange(`${first},${c}`)} label="Second colour" />
          </div>
        </div>
      )}

      {mode === "special" && (
        <SpecialPicker
          value={spec.kind === "rgb" ? { name: "rgb", main: spec.main } : spec.kind === "pride" ? { name: spec.flag, main: spec.main } : null}
          onChange={onChange}
        />
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Preview
        <span
          className={cn("h-2.5 w-28 rounded-full", preview.animated && "bucket-rgb")}
          style={preview.fill}
          data-testid="colour-preview"
          aria-hidden
        />
      </div>
    </div>
  );
}
