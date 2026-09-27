"use client";

import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { updateCategoryDueDay } from "@/app/grid/actions";

function ordinalSuffix(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function EditableDueDay({
  categoryId,
  dueDay,
}: {
  categoryId: number;
  dueDay: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(dueDay !== null ? String(dueDay) : "");
  const [, startTransition] = useTransition();

  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    const next = trimmed === "" ? null : parseInt(trimmed, 10);
    if (next !== null && (Number.isNaN(next) || next < 1 || next > 31)) {
      setValue(dueDay !== null ? String(dueDay) : "");
      return;
    }
    if (next === dueDay) return;
    startTransition(() => updateCategoryDueDay(categoryId, next));
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(dueDay !== null ? String(dueDay) : "");
            setEditing(false);
          }
        }}
        placeholder="Day…"
        className="w-14 shrink-0 rounded-full border border-input bg-card px-1.5 py-0.5 text-[0.65rem] outline-none"
      />
    );
  }

  if (dueDay === null) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:border-muted-foreground"
      >
        + due day
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[0.65rem] text-muted-foreground hover:bg-accent"
      title="Click to change due day"
    >
      <CalendarClock className="size-3" />
      Due {dueDay}
      {ordinalSuffix(dueDay)}
    </button>
  );
}
