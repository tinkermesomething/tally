"use client";

import { useState } from "react";

/** Value of the "+ New…" entry at the end of a category / income source dropdown. */
export const NEW_ITEM = "__new__";

type Item = { id: number; name: string };
type Target = { error: string } | { id: number } | { newName: string };

/** State for a dropdown of existing items that also lets the user type a new
 * one. resolve() turns it into what to submit: an existing id, a new name,
 * or the message to show. */
export function useNewOrExisting(items: Item[]) {
  const [value, setValue] = useState("");
  const [newName, setNewName] = useState("");

  function reset() {
    setValue("");
    setNewName("");
  }

  function resolve(messages: { pick: string; name: string }): Target {
    if (!value) return { error: messages.pick };
    if (value !== NEW_ITEM) return { id: parseInt(value, 10) };
    const name = newName.trim();
    if (!name) return { error: messages.name };
    // A name that already exists means that one, not a duplicate.
    const existing = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    return existing ? { id: existing.id } : { newName: name };
  }

  return { value, setValue, newName, setNewName, creating: value === NEW_ITEM, reset, resolve };
}
