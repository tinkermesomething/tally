"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Palette, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverPortal, PopoverPositioner } from "@/components/ui/popover";
import { SwatchRow, nativePickerActive } from "@/components/swatch-row";
import { ACCENTS, parseAccent } from "@/lib/accent";
import { SpecialPicker } from "@/components/special-picker";
import { useAccent } from "@/components/providers/accent-provider";
import { cn } from "@/lib/utils";

type Tab = "colours" | "duo" | "special";
const TABS: { id: Tab; label: string }[] = [
  { id: "colours", label: "Colours" },
  { id: "duo", label: "Two colours" },
  { id: "special", label: "Special" },
];

/** Choose the app's accent AND light/dark theme - one header button, not
 * two, by request (the palette icon was kept as the trigger over the
 * sun/moon one). The theme row lives inside the same popover rather than
 * its own button. */
export function AccentPicker() {
  const { accent, setAccent } = useAccent();
  const spec = parseAccent(accent);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(spec?.kind === "duo" ? "duo" : spec?.kind === "rgb" || spec?.kind === "pride" ? "special" : "colours");
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Same mounted-guard next-themes always needs: resolvedTheme is
  // undefined during SSR/first paint, so rendering off it before mount
  // would flash the wrong icon or mismatch hydration.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const duo = spec?.kind === "duo" ? spec.colors : (["#2a78d6", "#eb6834"] as [string, string]);
  const solid = spec?.kind === "solid" ? spec.color : "#2a78d6";

  return (
    <>
      <Button ref={anchorRef} variant="ghost" size="icon" aria-label="Choose accent color" onClick={() => setOpen((v) => !v)}>
        <Palette className="size-4" />
      </Button>
      <Popover open={open} onOpenChange={(next) => { if (!next && nativePickerActive()) return; setOpen(next); }}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchorRef} align="end" sideOffset={6}>
            {/* The popup is w-72 with p-3 padding, so its usable width is smaller
                than w-72: the panel inside must fill that space, not be w-72
                itself (that made everything spill out of the frame). */}
            <PopoverPopup className="max-w-[calc(100vw-1rem)]">
              <div className="min-w-0 space-y-3" data-testid="accent-panel">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Theme</span>
                  <div role="group" aria-label="Light or dark theme" className="inline-flex rounded-lg border border-input bg-muted/40 p-0.5">
                    <button
                      type="button"
                      aria-label="Light theme"
                      aria-pressed={mounted && resolvedTheme === "light"}
                      onClick={() => setTheme("light")}
                      className={cn("rounded-md border border-transparent p-1", mounted && resolvedTheme === "light" ? "accent-outline" : "text-muted-foreground hover:text-foreground")}
                    >
                      <Sun className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Dark theme"
                      aria-pressed={mounted && resolvedTheme === "dark"}
                      onClick={() => setTheme("dark")}
                      className={cn("rounded-md border border-transparent p-1", mounted && resolvedTheme === "dark" ? "accent-outline" : "text-muted-foreground hover:text-foreground")}
                    >
                      <Moon className="size-3.5" />
                    </button>
                  </div>
                </div>

                <div role="group" aria-label="Accent style" className="inline-flex rounded-lg border border-input bg-muted/40 p-0.5">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={cn("rounded-md border border-transparent px-2.5 py-1 text-xs transition-colors", tab === t.id ? "accent-outline font-medium" : "text-muted-foreground hover:text-foreground")}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === "colours" && (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Preset accents">
                      {ACCENTS.map((option) => {
                        const selected = accent === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-label={`Accent ${option.label.toLowerCase()}`}
                            aria-pressed={selected}
                            onClick={() => setAccent(option.id)}
                            className={cn("flex size-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-110", selected ? "border-foreground" : "border-transparent")}
                            style={{ backgroundColor: option.swatch }}
                          >
                            {selected && <Check className="size-4 text-white" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">More colours</span>
                      <SwatchRow value={spec?.kind === "solid" ? solid : ""} onChange={(c) => setAccent(`solid:${c}`)} label="Accent colour" />
                    </div>
                  </div>
                )}

                {tab === "duo" && (
                  <div className="space-y-2.5">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">First colour</span>
                      <SwatchRow value={duo[0]} onChange={(c) => setAccent(`duo:${c},${duo[1]}`)} label="First accent colour" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Second colour</span>
                      <SwatchRow value={duo[1]} onChange={(c) => setAccent(`duo:${duo[0]},${c}`)} label="Second accent colour" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      Preview
                      <span className="h-2.5 w-28 rounded-full" style={{ backgroundImage: `linear-gradient(90deg, ${duo[0]}, ${duo[1]})` }} aria-hidden />
                    </div>
                  </div>
                )}

                {tab === "special" && (
                  <SpecialPicker
                    value={spec?.kind === "rgb" ? { name: "rgb", main: spec.main } : spec?.kind === "pride" ? { name: spec.flag, main: spec.main } : null}
                    onChange={setAccent}
                  />
                )}
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  );
}
