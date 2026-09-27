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

