"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { moveCategoryToIndex } from "@/app/grid/actions";
import { runAction } from "@/lib/action-result";
import { beginPressAndHold } from "@/components/grid/press-and-hold-reorder";

/** Press-and-hold to reorder a category row among its siblings. `onPointerDown`
 * goes on the cell you press; the row itself carries data-reorder-group (who it
 * may be reordered among: top-level rows together, a category's subcategories
 * together) and data-reorder-id. Dropping calls the server, which only changes
 * the order - never an amount. */
export function useCategoryDrag(year: number) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The drag keeps rows displaced until the saved order has rendered: this
  // resolves the controller's promise when the transition has finished.
  const settled = useRef<{ resolve: () => void; reject: (e: unknown) => void; failed: boolean } | null>(null);
  useEffect(() => {
    if (!pending && settled.current) {
      const s = settled.current;
      settled.current = null;
      if (s.failed) s.reject(new Error("save failed"));
      else s.resolve();
    }
  }, [pending]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, group: string, id: number, childGroupPrefix?: string) => {
      const row = e.currentTarget.closest<HTMLElement>("[data-reorder-id]");
      if (!row) return;
      beginPressAndHold(e, {
        row,
        group,
        id,
        childGroupPrefix,
        onDrop: (toIndex) =>
          new Promise<void>((resolve, reject) => {
            settled.current = { resolve, reject, failed: false };
            setError(null);
            startTransition(async () => {
              const failure = await runAction(() => moveCategoryToIndex(id, toIndex, year));
              if (failure && settled.current) settled.current.failed = true;
              setError(failure);
            });
          }),
      });
    },
    [year]
  );

  return { onPointerDown, error };
}
