"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NEW_OPTION = "__new__";

type Option = { id: number; name: string };
type Created = { ok: true; id: number } | { ok: false; error: string };

/** A dropdown of existing categories or income sources that also ends in
 * "+ New…": pick that, type a name, and it is created and selected. Without
 * it a new budget has nothing to choose from until the user detours to
 * Settings. A name that already exists selects that one instead of making a
 * duplicate. */
export function OptionPicker({
  options,
  value,
  onChange,
  placeholder,
  newLabel,
  newPlaceholder,
  create,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  newLabel: string;
  newPlaceholder: string;
  create: (name: string) => Promise<Created>;
}) {
  // Until the page re-renders with fresh props, a just-created option exists only here.
  const [created, setCreated] = useState<Option[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const all = [...options, ...created.filter((c) => !options.some((o) => o.id === c.id))];
  const nameOf = (id: string) => all.find((o) => String(o.id) === id)?.name;

  function close() {
    setAdding(false);
    setName("");
    setError(null);
  }

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name.");
    const existing = all.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onChange(String(existing.id));
      return close();
    }
    startTransition(async () => {
      const res = await create(trimmed);
      if (!res.ok) return setError(res.error);
      setCreated((prev) => [...prev, { id: res.id, name: trimmed }]);
      onChange(String(res.id));
      close();
    });
  }

  return (
    <div className="space-y-1.5">
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === NEW_OPTION) return setAdding(true);
          onChange(v ?? "");
        }}
      >
        <SelectTrigger className="w-60" title={nameOf(value)}>
          <SelectValue>{(v: string) => (v ? (nameOf(v) ?? v) : placeholder)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {all.map((o) => (
            <SelectItem key={o.id} value={String(o.id)}>
              {o.name}
            </SelectItem>
          ))}
          <SelectItem value={NEW_OPTION}>{newLabel}</SelectItem>
        </SelectContent>
      </Select>
      {adding && (
        <div className="flex items-center gap-1.5">
          <Input
            className="w-40"
            placeholder={newPlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") close();
            }}
            autoFocus
          />
          <Button size="xs" onClick={add} disabled={pending}>
            Add
          </Button>
          <Button size="xs" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
