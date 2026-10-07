"use client";

import { moveCategoryToIndex } from "@/app/grid/actions";
import { useRowDrag } from "@/components/grid/use-row-drag";

/** Press-and-hold to reorder a category row among its siblings (top-level rows
 * together, a category's subcategories together). */
export function useCategoryDrag(year: number) {
  return useRowDrag((id, toIndex) => moveCategoryToIndex(id, toIndex, year));
}
