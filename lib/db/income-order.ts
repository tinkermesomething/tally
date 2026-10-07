import { eq, gte, isNull, or } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { incomeSources } from "./schema";

const MAX_NAME = 80;

/** Renames an income source. Only the name changes - entries, colour, pay
 * anchor and order are untouched. */
export async function renameIncomeSource(id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the income source a name.");
  if (trimmed.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`);
  const updated = await db.update(incomeSources).set({ name: trimmed }).where(eq(incomeSources.id, id)).returning({ id: incomeSources.id });
  if (updated.length === 0) throw new Error("That income source no longer exists.");
}

/** Moves an income source to a position (`toIndex`, 0 = first) among the
 * sources the grid shows for `year` - the same list you drag in, so what you
 * see is what moves. Only sort_order changes; no amount or entry is touched.
 * An index past either end is clamped. Returns false when nothing moved. */
export function reorderIncomeSourceTo(id: number, toIndex: number, year: number): Promise<boolean> {
  return inTransaction(async () => {
    if (!Number.isInteger(toIndex)) throw new Error("Pick a position.");
    const startOfNextYear = new Date(year + 1, 0, 1);
    const shown = await db.query.incomeSources.findMany({
      where: or(isNull(incomeSources.archivedAt), gte(incomeSources.archivedAt, startOfNextYear)),
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.id)], // same order the grid uses (id breaks ties)
    });
    const me = shown.find((s) => s.id === id);
    if (!me) throw new Error("That income source isn't shown for this year.");
    const from = shown.findIndex((s) => s.id === id);
    const to = Math.max(0, Math.min(shown.length - 1, toIndex));
    if (to === from) return false;

    const reordered = [...shown];
    reordered.splice(from, 1);
    reordered.splice(to, 0, me);

    // Hand the sources' own sort values back out in the new order; if two
    // tied (older data), number them afresh - still only among themselves.
    const values = shown.map((s) => s.sortOrder);
    const distinct = new Set(values).size === values.length;
    const next = distinct ? [...values].sort((a, b) => a - b) : reordered.map((_, i) => Math.min(...values) + i);
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].sortOrder !== next[i]) {
        await db.update(incomeSources).set({ sortOrder: next[i] }).where(eq(incomeSources.id, reordered[i].id));
      }
    }
    return true;
  });
}
