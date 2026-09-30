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

// A budget cell's amount text: neutral until something's actually been
// spent against it (nothing to judge yet), green once spending is at or
// under plan, red once it's over - only meaningful when there's a real
// planned figure to compare against.
export function budgetValueColorClass(
  amountPence: number | undefined,
  spentPence: number
): string {
  if (spentPence === 0 || amountPence === undefined) return "text-foreground"
  return spentPence <= amountPence ? "text-status-good" : "text-status-critical"
}

