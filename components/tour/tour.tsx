"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { markTourSeen } from "@/app/tour-actions";
import { TOUR_STEPS, nextStep, previousStep, stepsToShow, type TourStep } from "@/lib/help/tour";

const PAD = 8; // space around the highlighted element
const GAP = 12; // space between the highlight and the card
const CARD_W = 352; // 22rem
const MOBILE_QUERY = "(max-width: 767px)";

type Box = { top: number; left: number; width: number; height: number };

/** The first element with this anchor that is actually on screen. Two can
 * exist (the desktop table and the mobile cards), and one is always hidden. */
function findAnchor(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** The anchor's box clipped to the window, so a tall grid still highlights
 * the part you can see. */
function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top - PAD, 0);
  const left = Math.max(r.left - PAD, 0);
  const bottom = Math.min(r.bottom + PAD, window.innerHeight);
  const right = Math.min(r.right + PAD, window.innerWidth);
  return { top, left, width: right - left, height: bottom - top };
}

export function Tour({ autoStart, desktop }: { autoStart: boolean; desktop: boolean }) {
  const { showHelpIcons } = useAppSettings();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [mobile, setMobile] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Start once, after the page has painted so the anchors have a size.
  useEffect(() => {
    if (!autoStart) return;
    const id = requestAnimationFrame(() => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setMobile(window.matchMedia(MOBILE_QUERY).matches);
      setSteps(stepsToShow(TOUR_STEPS, (a) => findAnchor(a) !== null));
      setIndex(0);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStart]);

  const finish = useCallback(() => {
    setSteps(null);
    setBox(null);
    // ?tour=1 would restart it on refresh. Keep every other parameter.
    const url = new URL(window.location.href);
    if (url.searchParams.has("tour")) {
      url.searchParams.delete("tour");
      window.history.replaceState(null, "", url);
    }
    returnFocus.current?.focus?.();
    // Fire and forget: if it fails, the tour just shows again next time.
    void markTourSeen().catch(() => {});
  }, []);

  const step = steps?.[index];
  const anchor = step?.anchor;

  // Follow the anchor: scroll it into view, then track it through resize and scroll.
  useLayoutEffect(() => {
    if (!anchor) {
      setBox(null);
      return;
    }
    const el = findAnchor(anchor);
    if (!el) {
      setBox(null);
      return;
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    const update = () => setBox(boxOf(el));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, index]);

  // Move focus into the card on every step, so a screen reader reads it and
  // the keyboard works from there.
  useEffect(() => {
    if (step) cardRef.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus();
  }, [step, index]);

  if (!steps || !step) return null;

  const last = index === steps.length - 1;
  const ctx = { desktop, mobile, helpIcons: showHelpIcons };
  const title = step.title(ctx);

  function go(move: ReturnType<typeof nextStep>) {
    if ("finished" in move) finish();
    else setIndex(move.index);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
      return;
    }
    if (e.key !== "Tab") return;
    // Keep Tab inside the card: the page behind is dimmed and not for use.
    const items = cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    if (!items?.length) return;
    const first = items[0];
    const lastItem = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && document.activeElement === lastItem) {
      e.preventDefault();
      first.focus();
    }
  }

  // Card position: on a phone, docked to the bottom. Otherwise below the
  // highlight, else above it, else docked bottom-right (a tall grid).
  let cardStyle: React.CSSProperties;
  if (!box) {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  } else if (mobile) {
    cardStyle = { left: 16, right: 16, bottom: 16 };
  } else {
    const left = Math.min(Math.max(box.left, 16), window.innerWidth - CARD_W - 16);
    const below = window.innerHeight - (box.top + box.height) - GAP;
    const above = box.top - GAP;
    const needed = 220;
    if (below >= needed) cardStyle = { top: box.top + box.height + GAP, left };
    else if (above >= needed) cardStyle = { bottom: window.innerHeight - box.top + GAP, left };
    else cardStyle = { right: 24, bottom: 24 };
  }

  return createPortal(
    <div className="fixed inset-0 z-[80]" onKeyDown={onKeyDown}>
      {/* Takes every click, so the page behind cannot be used mid-tour. */}
      <div className="absolute inset-0" aria-hidden="true" />
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] transition-[top,left,width,height] duration-200 motion-reduce:transition-none"
          style={box}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="absolute rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-xl"
        style={{ ...cardStyle, width: box && mobile ? undefined : `min(${CARD_W}px, calc(100vw - 32px))` }}
      >
        <p className="mb-1 text-xs text-muted-foreground">
          {index + 1} of {steps.length}
        </p>
        <h2 id="tour-title" className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body(ctx)}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          {last ? (
            <span />
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={finish}>
              Skip tour
            </Button>
          )}
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => go(previousStep(index))}>
                Back
              </Button>
            )}
            <Button type="button" size="sm" data-tour-primary onClick={() => go(nextStep(index, steps.length))}>
              {index === 0 ? "Start" : last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          Step {index + 1} of {steps.length}: {title}
        </div>
      </div>
    </div>,
    document.body
  );
}
