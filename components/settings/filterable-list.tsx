"use client";

import { useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { filterByFuzzy } from "@/lib/fuzzy";

export type FilterableItem = {
  key: string | number;
  /** Everything a search should be able to find this row by. */
  texts: (string | null | undefined)[];
  node: ReactNode;
};

/** A typo-tolerant filter box over a list of server-rendered settings rows.
 * Rows keep their original order - only non-matching ones are hidden. */
export function FilterableList({
  items,
  placeholder,
  label,
}: {
  items: FilterableItem[];
  placeholder: string;
  /** Plural noun for the count and empty message, e.g. "rules". */
  label: string;
}) {
  const [query, setQuery] = useState("");
  const shown = filterByFuzzy(items, query, (i) => i.texts);
  const filtering = query.trim() !== "";

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={`Search ${label}`}
          className="pl-8 pr-8"
        />
        {filtering && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {filtering && (
        <p className="text-xs text-muted-foreground">
          {shown.length} of {items.length} {label} · clear the search to reorder
        </p>
      )}
      {shown.length === 0 && filtering ? (
        <p className="text-sm text-muted-foreground">No {label} match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className="space-y-2" data-reorder-off={filtering ? "" : undefined}>
          {shown.map((i) => (
            <div key={i.key}>{i.node}</div>
          ))}
        </div>
      )}
    </div>
  );
}
