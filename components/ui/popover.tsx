"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverPortal({ ...props }: PopoverPrimitive.Portal.Props) {
  return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />
}

/**
 * Portals the popup to the document body and positions it against `anchor`
 * via Base UI's own collision-aware placement - this is the fix for a real
 * bug: a hand-rolled `position: absolute` popup inside a scrollable grid
 * table gets clipped by the table's own `overflow` boundary (z-index can't
 * escape an ancestor's overflow clip, only a portal can), forcing the user
 * to scroll the table to see content that's really just rendered off-screen
 * within the clipped region.
 */
function PopoverPositioner({
  className,
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Positioner.Props) {
  return (
    <PopoverPrimitive.Positioner
      data-slot="popover-positioner"
      sideOffset={sideOffset}
      className={cn("z-50 outline-none", className)}
      {...props}
    />
  )
}

function PopoverPopup({ className, ...props }: PopoverPrimitive.Popup.Props) {
  return (
    <PopoverPrimitive.Popup
      data-slot="popover-popup"
      className={cn(
        "w-72 origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

export { Popover, PopoverTrigger, PopoverPortal, PopoverPositioner, PopoverPopup }
