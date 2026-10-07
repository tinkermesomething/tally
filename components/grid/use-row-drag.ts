"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { runAction } from "@/lib/action-result";
import { beginPressAndHold } from "@/components/grid/press-and-hold-reorder";

/** Press-and-hold to reorder a row among its siblings. `onPointerDown` goes on
 * the cell you press; the row itself carries data-reorder-group (who it may be
 * reordered among) and data-reorder-id. Dropping calls `save`, which must only
 * change the order - never an amount. Shared by the grid's categories and
 * income sources and the matching Settings lists, so they all move the same way. */
export function useRowDrag(save: (id: number, toIndex: number) => Promise<unknown>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saveRef = useRef(save);
  saveRef.current = save;
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

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>, group: string, id: number, childGroupPrefix?: string) => {
    const row = e.currentTarget.closest<HTMLElement>("[data-reorder-id]");
    if (!row) return;
    // A search filter hides rows, so a drop position would not match the saved order.
    if (row.closest("[data-reorder-off]")) return;
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
            const failure = await runAction(() => saveRef.current(id, toIndex));
            if (failure && settled.current) settled.current.failed = true;
            setError(failure);
          });
        }),
    });
  }, []);

  return { onPointerDown, error };
}
