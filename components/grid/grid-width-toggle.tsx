"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageWidth } from "@/components/page-width";

/** Desktop only - the phone layout is a card list, not a wide grid. */
export function GridWidthToggle({ target = "grid" }: { target?: string }) {
  const { wide, setWide } = usePageWidth();
  return (
    <Button
      type="button"
      size="sm"
      variant={wide ? "secondary" : "outline"}
      className="hidden md:inline-flex"
      aria-pressed={wide}
      title={wide ? "Back to the standard width" : `Stretch the ${target} to the full page width`}
      onClick={() => setWide(!wide)}
    >
      {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      {wide ? "Standard width" : "Expand"}
    </Button>
  );
}
