import { eq } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { categories, groupStyles } from "./schema";

const MAX_NAME = 80;

/** Every stored colour override, keyed by group name - lib/group-colors.ts's
 * buildGroupColorMap takes this as its optional second argument. */
export async function getGroupStyles(): Promise<Map<string, string>> {
  const rows = await db.select().from(groupStyles);
  return new Map(rows.map((r) => [r.name, r.color]));
}

/** Sets (or, with null, clears back to the auto-picked palette colour) one
 * group's own colour. Same "#rrggbb" validation as setPersonColor/
 * setAssetColor. */
export async function setGroupColor(name: string, color: string | null) {
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("Colour must look like #1a2b3c.");
  if (color === null) {
    await db.delete(groupStyles).where(eq(groupStyles.name, name));
    return;
  }
  const existing = await db.query.groupStyles.findFirst({ where: eq(groupStyles.name, name) });
  if (existing) {
    await db.update(groupStyles).set({ color }).where(eq(groupStyles.id, existing.id));
  } else {
    await db.insert(groupStyles).values({ name, color });
  }
}

/** Renames a group - every category currently using the old name moves to
 * the new one in one update (groupName is free text shared across
 * categories, not a foreign key to rename once). If the new name is
 * already in use by a different group (a merge, not a plain rename) and
 * THAT group already has its own colour, the old group's override is
 * dropped rather than fought over the unique name - the destination
 * group's existing colour wins, which is the only sane outcome for two
 * groups becoming one. */
export async function renameGroup(oldName: string, newName: string) {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("Give it a name.");
  if (trimmed.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`);
  if (trimmed === oldName) return;

  await inTransaction(async () => {
    await db.update(categories).set({ groupName: trimmed }).where(eq(categories.groupName, oldName));

    const oldStyle = await db.query.groupStyles.findFirst({ where: eq(groupStyles.name, oldName) });
    if (!oldStyle) return;

    const destStyle = await db.query.groupStyles.findFirst({ where: eq(groupStyles.name, trimmed) });
    if (destStyle) {
      await db.delete(groupStyles).where(eq(groupStyles.id, oldStyle.id));
    } else {
      await db.update(groupStyles).set({ name: trimmed }).where(eq(groupStyles.id, oldStyle.id));
    }
  });
}
