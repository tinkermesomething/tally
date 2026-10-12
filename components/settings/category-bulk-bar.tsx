"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCategorySelection } from "@/components/settings/category-selection-provider";
import { bulkSetCategoryGroup, bulkSetHouseholdShare } from "@/app/grid/actions";

/** Appears once anything's checked in the Categories tab. "Set group"
 * only actually moves top-level ids (subcategories are silently skipped
 * server-side - see bulkUpdateCategoryGroup); "Share"/"Unshare" only
 * moves leaf ids (same skip rule, mirrors the single-category UI). The
 * `updated` count in the result can be lower than the selection size -
 * that's expected, not an error, so it's reported plainly rather than
 * flagged. */
export function CategoryBulkBar({ existingGroups, householdEnabled }: { existingGroups: string[]; householdEnabled: boolean }) {
  const { selected, clear } = useCategorySelection();
  const [group, setGroup] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (selected.size === 0) return null;
  const ids = Array.from(selected);

  function applyGroup() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await bulkSetCategoryGroup(ids, group);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(`Set the group for ${res.updated} ${res.updated === 1 ? "category" : "categories"}.`);
      setGroup("");
    });
  }

  function applyHousehold(share: boolean) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await bulkSetHouseholdShare(ids, share);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(`${share ? "Shared" : "Stopped sharing"} ${res.updated} ${res.updated === 1 ? "category" : "categories"}.`);
    });
  }

  return (
    <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-sm font-medium">{selected.size} selected</span>
      <Input
        list="bulk-category-groups"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        placeholder="Group name…"
        className="h-8 w-40"
      />
      <datalist id="bulk-category-groups">
        {existingGroups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <Button size="sm" variant="outline" disabled={pending || !group.trim()} onClick={applyGroup}>
        Set group
      </Button>
      {householdEnabled && (
        <>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => applyHousehold(true)}>
            Share to household
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => applyHousehold(false)}>
            Stop sharing
          </Button>
        </>
      )}
      {message && <span className="text-xs text-status-good">{message}</span>}
      {error && <span className="text-xs text-status-critical">{error}</span>}
      <Button size="icon-xs" variant="ghost" onClick={clear} title="Clear selection" className="ml-auto">
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
