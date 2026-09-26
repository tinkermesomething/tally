"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

/** Click-to-edit text: plain (wrapping) text until clicked, then an input
 * until blur/Enter commits - matches how a spreadsheet cell behaves, and
 * avoids forcing long names onto one unwrappable line the rest of the time. */
export function InlineEditText({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
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
