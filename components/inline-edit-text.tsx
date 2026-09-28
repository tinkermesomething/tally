"use client";

import { useState, useTransition } from "react";
import { MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Click-to-edit text: plain (wrapping) text until clicked, then an input
 * until blur/Enter commits - matches how a spreadsheet cell behaves, and
 * avoids forcing long names onto one unwrappable line the rest of the time. */
export function InlineEditText({
  value,
  onCommit,
  onDelete,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  /** Shows a small archive icon to the left of the input, only while
   * editing - a quicker path than Settings for archiving right from the
   * grid, without cluttering the row the rest of the time. */
  onDelete?: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [pending, startTransition] = useTransition();

  function commit() {
    setEditing(false);
    const trimmed = text.trim();
    if (!trimmed) {
      setText(value);
      return;
    }
    if (trimmed === value) return;
    startTransition(() => onCommit(trimmed));
  }

  if (editing) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {onDelete && (
          <button
            type="button"
            title="Archive"
            // The input's onBlur fires (and commits/exits edit mode) before
            // this button's own click would - by the time click fired, this
            // button had already been unmounted, so the click never landed.
            // Blocking the blur-causing mousedown keeps the button mounted
            // long enough for its click to actually fire.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDelete}
            className="shrink-0 text-status-critical hover:opacity-70"
          >
            <MinusCircle className="size-3.5" />
          </button>
        )}
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(value);
              setEditing(false);
            }
          }}
          className={cn(
            "min-w-0 flex-1 rounded-md border border-input bg-card px-1 py-0.5 outline-none",
            className
          )}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={value}
      className={cn(
        "min-w-0 flex-1 truncate rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-input",
        pending && "opacity-60",
        className
      )}
    >
      {value}
    </button>
  );
}
