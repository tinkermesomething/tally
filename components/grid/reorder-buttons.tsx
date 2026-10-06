"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { reorderCategory } from "@/app/grid/actions";
import { runAction } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/** Move a category one place up or down among its siblings (top-level
 * categories among top-level ones; a subcategory only inside its own
 * category - moving it to another category is done in Settings). Only the
 * order changes; no amount is touched. */
export function ReorderButtons({
  categoryId,
  categoryName,
  year,
  canMoveUp,
  canMoveDown,
  className,
}: {
  categoryId: number;
  categoryName: string;
  year: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      setError(await runAction(() => reorderCategory(categoryId, direction, year)));
    });
  }

  const base = "rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-25";
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} data-testid="reorder">
      <button type="button" disabled={!canMoveUp || pending} onClick={() => move("up")} title="Move up" aria-label={`Move ${categoryName} up`} className={base}>
        <ChevronUp className="size-3.5 text-chart-1" />
      </button>
      <button type="button" disabled={!canMoveDown || pending} onClick={() => move("down")} title="Move down" aria-label={`Move ${categoryName} down`} className={base}>
        <ChevronDown className="size-3.5 text-chart-1" />
      </button>
      {error && (
        <span role="alert" className="ml-1 text-[0.65rem] text-status-critical">
          {error}
        </span>
      )}
    </span>
  );
}
