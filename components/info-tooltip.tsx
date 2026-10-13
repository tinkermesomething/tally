"use client";

import { Info } from "lucide-react";
import { Popover, PopoverTrigger, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";

/** A small (i) button that reveals a short explanation on click - for the
 * one or two sentences of context a page needs, without it sitting in the
 * page as a permanent paragraph everyone has to read past every time. */
export function InfoTooltip({ children, label = "More info" }: { children: React.ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Info className="size-4" />
          </button>
        }
      />
      <PopoverPortal>
        <PopoverPositioner align="start">
          <PopoverPopup className="text-sm text-muted-foreground">{children}</PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
