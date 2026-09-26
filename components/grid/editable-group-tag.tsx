"use client";

import { useState, useTransition } from "react";
import { updateCategoryGroup } from "@/app/grid/actions";

export function EditableGroupTag({
  categoryId,
  groupName,
  color,
  existingGroups,
}: {
  categoryId: number;
  groupName: string | null;
  color: string;
  existingGroups: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(groupName ?? "");
  const [, startTransition] = useTransition();
  const listId = `groups-${categoryId}`;

  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed === (groupName ?? "")) return;
    startTransition(() => updateCategoryGroup(categoryId, trimmed));
  }

  if (editing) {
    return (
      <>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setValue(groupName ?? "");
              setEditing(false);
            }
          }}
          list={listId}
          placeholder="Group…"
          className="w-24 shrink-0 rounded-full border border-input bg-card px-1.5 py-0.5 text-[0.65rem] outline-none"
        />
        <datalist id={listId}>
          {existingGroups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </>
    );
  }

  if (!groupName) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:border-muted-foreground"
      >
        + group
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[0.65rem] text-muted-foreground hover:bg-accent"
      title="Click to change group"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {groupName}
    </button>
  );
}
