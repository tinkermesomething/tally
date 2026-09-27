export { cn } from "cn"

// Shared treatment for the "Year Total" sticky column - a colored divider on
// its left edge (a plain drop shadow reads as invisible on a dark surface),
// so the Year Total/Monthly avg pair reads as a separate floating panel
// rather than just more columns in the scroll.
export const FLOATING_PANEL_EDGE = "border-l-[3px] border-primary"

// A solid (non-transparent) accent tint to mix into a cell's own background,
// so the floating panel's fill reads as distinct too, not just its edge.
// Must stay a flat color - an alpha-blended background would let whatever
// sits behind a sticky cell bleed through it during horizontal scroll.
export function floatingPanelFill(baseVar: string) {
  return `color-mix(in oklab, var(--primary) 7%, var(${baseVar}))`
}

// Freezes a table's header row at the top of the viewport while its body
// scrolls past (Excel/Sheets' "freeze top row") - the page scrolls
// vertically, not these tables themselves, so `top-0` sticks relative to
// the viewport, not the table's own (non-scrolling) wrapper. z-20 keeps it
// above both the body's sticky columns (z-10) and the horizontal-scroll
// shadow overlay (z-15).
export const STICKY_HEADER_ROW = "sticky top-0 z-20"

