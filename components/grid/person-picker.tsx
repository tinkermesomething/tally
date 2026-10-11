"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createPerson } from "@/app/debt/actions";

export const NEW_PERSON = "__new__";

/** Shared "pick an existing debt person, or type a new one" state, used by
 * both AddIncomeDialog (money borrowed) and LogExpenseDialog (money paid
 * back) - identical mechanics in both, just different surrounding copy. */
export function usePersonSelection() {
  const [personId, setPersonId] = useState("");
  const [newPersonName, setNewPersonName] = useState("");

  function reset() {
    setPersonId("");
    setNewPersonName("");
  }

  /** Resolves the current selection to a real person id, creating the new
   * person first if "+ New…" was chosen. Callers validate personId
   * (and, when it's NEW_PERSON, that a name was entered) before calling
   * this - it doesn't re-validate. */
  async function resolvePersonId(): Promise<number> {
    if (personId === NEW_PERSON) {
      const person = await createPerson(newPersonName);
      return person.id;
    }
    return parseInt(personId, 10);
  }

  return { personId, setPersonId, newPersonName, setNewPersonName, reset, resolvePersonId };
}

export function PersonPickerField({
  idPrefix,
  label,
  placeholder,
  people,
  personId,
  onPersonIdChange,
  newPersonName,
  onNewPersonNameChange,
}: {
  idPrefix: string;
  label: string;
  placeholder: string;
  people: { id: number; name: string }[];
  personId: string;
  onPersonIdChange: (personId: string) => void;
  newPersonName: string;
  onNewPersonNameChange: (name: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-person`}>{label}</Label>
      <Select value={personId} onValueChange={(v) => onPersonIdChange(v ?? "")}>
        <SelectTrigger id={`${idPrefix}-person`} className="w-full">
          <SelectValue>
            {(value: string) => {
              if (!value) return placeholder;
              if (value === NEW_PERSON) return "+ New…";
              return people.find((p) => String(p.id) === value)?.name ?? value;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {people.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.name}
            </SelectItem>
          ))}
          <SelectItem value={NEW_PERSON}>+ New…</SelectItem>
        </SelectContent>
      </Select>
      {personId === NEW_PERSON && (
        <Input
          placeholder="Their name"
          value={newPersonName}
          onChange={(e) => onNewPersonNameChange(e.target.value)}
          autoFocus
        />
      )}
    </div>
  );
}
