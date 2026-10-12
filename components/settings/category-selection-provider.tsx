"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type CategorySelectionContextValue = {
  selected: Set<number>;
  toggle: (id: number) => void;
  clear: () => void;
};

const CategorySelectionContext = createContext<CategorySelectionContextValue | null>(null);

/** Wraps the whole Categories tab (app/settings/page.tsx) so checkboxes on
 * individual rows (CategorySettingsRow) and the bulk-action bar
 * (CategoryBulkBar) share one selection, without threading it through
 * every row's props by hand. */
export function CategorySelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clear() {
    setSelected(new Set());
  }

  return <CategorySelectionContext.Provider value={{ selected, toggle, clear }}>{children}</CategorySelectionContext.Provider>;
}

export function useCategorySelection(): CategorySelectionContextValue {
  const ctx = useContext(CategorySelectionContext);
  if (!ctx) throw new Error("useCategorySelection must be used within CategorySelectionProvider");
  return ctx;
}
