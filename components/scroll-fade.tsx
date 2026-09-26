"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const SCROLL_STEP = 360;

/**
 * Wraps a horizontally-scrollable region and shows a floating, clickable
 * chevron "bubble" on whichever edge still has more content to scroll to -
 * a plain background fade was too subtle to notice against the table's own
 * header/footer tinting, so this is an actual affordance instead.
 */
export function ScrollFade({
  children,
  className,
  leftInset = 0,
  rightInset = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Bubbles sit just past a sticky column, not on top of it. */
  leftInset?: number;
  rightInset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  function scrollBy(delta: number) {
    ref.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div ref={ref} className={className}>
        {children}
      </div>
      {/* Anchored near the header row rather than centered on the whole
          (often very tall) table, so it's visible as soon as the table is,
          not just when scrolled to its vertical midpoint. */}
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollBy(-SCROLL_STEP)}
        style={{ left: leftInset + 8, top: 12 }}
        className={cn(
          "absolute z-20 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md transition-opacity duration-200",
          canScrollLeft ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollBy(SCROLL_STEP)}
        style={{ right: rightInset + 8, top: 12 }}
        className={cn(
          "absolute z-20 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md transition-opacity duration-200",
          canScrollRight ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
