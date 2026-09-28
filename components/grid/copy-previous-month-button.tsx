"use client";

import { useTransition } from "react";
import { CopyPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyPreviousMonthValues } from "@/app/grid/actions";

/** Bulk version of the per-cell "use last month's value" hint - fills every
 * still-blank cell (categories and income both) for one target month from
 * whatever the previous month has, without ever overwriting a cell that
 * already has something in it. `compact` renders as an icon-only button for
 * sitting inline in a month column header, instead of the full labeled one. */
export function CopyPreviousMonthButton({
  year,
  month,
  compact = false,
}: {
  year: number;
  month: number;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const title = "Fill blank cells this month from last month's values";

  if (compact) {
    return (
      <button
        type="button"
        disabled={pending}
        title={title}
        onClick={() => startTransition(() => copyPreviousMonthValues({ year, month }))}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 disabled:opacity-60"
      >
        <CopyPlus className="size-3" />
      </button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      title={title}
      onClick={() => startTransition(() => copyPreviousMonthValues({ year, month }))}
    >
      <CopyPlus className="size-4" />
      {pending ? "Copying…" : "Copy last month"}
    </Button>
  );
}
