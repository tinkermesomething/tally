"use client";

import { useTransition } from "react";
import { CopyPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyPreviousMonthValues } from "@/app/grid/actions";

/** Bulk version of the per-cell "use last month's value" hint - fills every
 * still-blank cell (categories and income both) for one target month from
 * whatever the previous month has, without ever overwriting a cell that
 * already has something in it. */
export function CopyPreviousMonthButton({ year, month }: { year: number; month: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      title="Fill blank cells this month from last month's values"
      onClick={() => startTransition(() => copyPreviousMonthValues({ year, month }))}
    >
      <CopyPlus className="size-4" />
      {pending ? "Copying…" : "Copy last month"}
    </Button>
  );
}
