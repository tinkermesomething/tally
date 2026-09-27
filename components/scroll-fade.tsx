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
  containerRef: externalRef,
  onScroll,
}: {
  children: React.ReactNode;
  className?: string;
  /** Bubbles sit just past a sticky column, not on top of it. */
  leftInset?: number;
  rightInset?: number;
  /** Lets a parent share/control the scroll element directly (e.g. to sync
   * scroll position across several tables) instead of ScrollFade owning an
   * internal ref nothing outside it can reach. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (el: HTMLDivElement) => void;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const ref = externalRef ?? internalRef;
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
      onScroll?.(el);
    }

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scrollBy(delta: number) {
    ref.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div ref={ref} className={className}>
        {children}
      </div>
      {/* Shadow cast by the sticky columns onto whatever's scrolling
          underneath them - only shown while there's actually content
          hidden there, so it disappears at the true start/end of the
          table where nothing is underneath to cast a shadow from. */}
      <div
        aria-hidden
        style={{
          left: leftInset,
          width: 14,
          background: "linear-gradient(to right, rgba(0,0,0,0.3), transparent)",
        }}
        className={cn(
          "pointer-events-none absolute inset-y-0 z-[15] transition-opacity duration-200",
          canScrollLeft ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        aria-hidden
        style={{
          right: rightInset,
          width: 14,
          background: "linear-gradient(to left, rgba(0,0,0,0.3), transparent)",
        }}
        className={cn(
          "pointer-events-none absolute inset-y-0 z-[15] transition-opacity duration-200",
          canScrollRight ? "opacity-100" : "opacity-0"
        )}
      />
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
