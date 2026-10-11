"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageWidth } from "@/components/page-width";

/** Desktop only - the phone layout is a card list, not a wide grid.
 * `iconOnly` drops the text label (the title attribute still carries it) -
 * used where the button sits among other small icon controls (app/grid/page.tsx);
 * TrendReport keeps the labeled default. */
export function GridWidthToggle({ target = "grid", iconOnly = false }: { target?: string; iconOnly?: boolean }) {
  const { wide, setWide } = usePageWidth();
  return (
    <Button
      type="button"
      size={iconOnly ? "icon-sm" : "sm"}
      variant={wide ? "secondary" : "outline"}
      className="hidden md:inline-flex"
      aria-pressed={wide}
      title={wide ? "Back to the standard width" : `Stretch the ${target} to the full page width`}
      onClick={() => setWide(!wide)}
    >
      {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      {!iconOnly && (wide ? "Standard width" : "Expand")}
    </Button>
  );
}
