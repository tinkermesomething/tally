import { eq, gte, isNull, or } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { categories, categoryParentMoves } from "./schema";

export type ParentMove = { id: number; categoryId: number; parentId: number | null; effectiveYear: number };

/** For each category, resolves its effective parent for a given year: the
 * parentId of its most recent move with effectiveYear <= year, or its
 * original (creation-time) parentId if no qualifying move exists - the
 * same year-relative principle as archivedAt, generalized to handle a
 * category moving more than once. Pure function, no DB access, so it's
 * cheap to unit test against a plain list of moves. */
export function resolveEffectiveParents(
  cats: { id: number; parentId: number | null }[],
  moves: ParentMove[],
  year: number
): Map<number, number | null> {
  const movesByCategory = new Map<number, ParentMove[]>();
  for (const m of moves) {
    const list = movesByCategory.get(m.categoryId) ?? [];
    list.push(m);
    movesByCategory.set(m.categoryId, list);
  }
  const result = new Map<number, number | null>();
  for (const c of cats) {
    const qualifying = (movesByCategory.get(c.id) ?? [])
      .filter((m) => m.effectiveYear <= year)
      // Most recent effectiveYear wins; ties (more than one move within
      // the same year - the common case, since a move always takes effect
      // "this year") break on id, so the most recently made move wins
      // rather than whichever happened to come first in an untied sort.
      .sort((a, b) => b.effectiveYear - a.effectiveYear || b.id - a.id);
    result.set(c.id, qualifying.length > 0 ? qualifying[0].parentId : c.parentId);
  }
  return result;
}

/** The only correct way to read a resolveEffectiveParents() result. Plain
 * `effectiveParents.get(id) ?? category.parentId` is a real bug: `??`
 * can't tell "no entry for this id" apart from "entry is null" - and a
 * resolved effective parent of null (genuinely top-level) is one of the
 * most common, valid results this map produces. That pattern silently
 * discarded every "moved to top-level" resolution, falling back to the
 * category's stale original parentId instead. */
export function effectiveParentOf(
  effectiveParents: Map<number, number | null>,
  category: { id: number; parentId: number | null }
): number | null {
  return effectiveParents.has(category.id) ? (effectiveParents.get(category.id) ?? null) : category.parentId;
}

/** parent id -> its children, using each category's EFFECTIVE parent for the
 * year being viewed (not necessarily its original parentId). */
export function groupChildrenByParent<T extends { id: number; parentId: number | null }>(
  cats: T[],
  effectiveParents: Map<number, number | null>
): Map<number, T[]> {
  const byParent = new Map<number, T[]>();
  for (const c of cats) {
    const parentId = effectiveParentOf(effectiveParents, c);
    if (parentId === null) continue;
    const list = byParent.get(parentId) ?? [];
    list.push(c);
    byParent.set(parentId, list);
  }
  return byParent;
}

async function getEffectiveParentMap(year: number): Promise<Map<number, number | null>> {
  const cats = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const moves = await db.select().from(categoryParentMoves);
  return resolveEffectiveParents(cats, moves, year);
}

/** Moves a category to a new parent (or to top-level, if newParentId is
 * null) starting this calendar year - past years keep showing it under
 * its old grouping, so moving something today never rewrites what a past
 * year's rollup said. Only a genuine leaf category can move: this app's
 * rollup logic is strictly two levels deep, so a category currently acting
 * as someone else's parent can't also become a child, and a category can
 * only be nested under a genuine top-level category, never under another
 * child (which would make three levels). */
export async function moveCategoryParent(categoryId: number, newParentId: number | null) {
  if (newParentId === categoryId) {
    throw new Error("A category can't be its own parent.");
  }
  const category = await db.query.categories.findFirst({ where: eq(categories.id, categoryId) });
  if (!category) throw new Error("Category not found.");

  const currentYear = new Date().getFullYear();
  const effectiveParents = await getEffectiveParentMap(currentYear);

  const hasChildrenNow = Array.from(effectiveParents.values()).some((p) => p === categoryId);
  if (hasChildrenNow) {
    throw new Error("Can't move a category that currently has its own subcategories.");
  }

  if (newParentId !== null) {
    const newParent = await db.query.categories.findFirst({ where: eq(categories.id, newParentId) });
    if (!newParent) throw new Error("Target category not found.");
    const targetEffectiveParent = effectiveParentOf(effectiveParents, newParent);
    if (targetEffectiveParent !== null) {
      throw new Error("Can't nest under a subcategory - only top-level categories can have children.");
    }
  }

  await db.insert(categoryParentMoves).values({
    categoryId,
    parentId: newParentId,
    effectiveYear: currentYear,
  });
}

/** Moves a category to a given position (`toIndex`, 0 = first) among its
 * SIBLINGS: top-level categories among the top-level ones, a subcategory only
 * among the other subcategories of its own parent (moving to a different
 * parent is a separate, deliberate action - see moveCategoryParent).
 * "Siblings" are the categories the grid shows for `year`, so what you see is
 * what moves.
 *
 * It only ever rewrites sort_order, and only among those siblings: no amount,
 * paid flag, entry or parent link is touched, so no total can change. An index
 * past either end is clamped. Returns false when nothing moved (already
 * there), which is not an error. */
export function reorderCategoryTo(categoryId: number, toIndex: number, year: number): Promise<boolean> {
  return inTransaction(async () => {
    if (!Number.isInteger(toIndex)) throw new Error("Pick a position.");
    const startOfNextYear = new Date(year + 1, 0, 1);
    const cats = await db.query.categories.findMany({
      where: or(isNull(categories.archivedAt), gte(categories.archivedAt, startOfNextYear)),
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.id)], // same order the grid uses (id breaks ties)
    });
    const effectiveParents = resolveEffectiveParents(cats, await db.select().from(categoryParentMoves), year);
    const me = cats.find((c) => c.id === categoryId);
    if (!me) throw new Error("That category isn't shown for this year.");

    const parent = effectiveParentOf(effectiveParents, me);
    const siblings = cats.filter((c) => effectiveParentOf(effectiveParents, c) === parent);
    const from = siblings.findIndex((c) => c.id === categoryId);
    const to = Math.max(0, Math.min(siblings.length - 1, toIndex));
    if (to === from) return false;

    const reordered = [...siblings];
    reordered.splice(from, 1);
    reordered.splice(to, 0, me);

    // Hand the siblings' own sort values back out in the new order. If two of
    // them tied (older data), number them afresh - still only among themselves.
    const values = siblings.map((c) => c.sortOrder);
    const distinct = new Set(values).size === values.length;
    const next = distinct ? [...values].sort((a, b) => a - b) : reordered.map((_, i) => Math.min(...values) + i);
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].sortOrder !== next[i]) {
        await db.update(categories).set({ sortOrder: next[i] }).where(eq(categories.id, reordered[i].id));
      }
    }
    return true;
  });
}

/** One place up or down - the same move, a step at a time. Returns false at
 * either end. */
export async function moveCategoryOrder(categoryId: number, direction: "up" | "down", year: number): Promise<boolean> {
  const startOfNextYear = new Date(year + 1, 0, 1);
  const cats = await db.query.categories.findMany({
    where: or(isNull(categories.archivedAt), gte(categories.archivedAt, startOfNextYear)),
    orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.id)],
  });
  const effectiveParents = resolveEffectiveParents(cats, await db.select().from(categoryParentMoves), year);
  const me = cats.find((c) => c.id === categoryId);
  if (!me) throw new Error("That category isn't shown for this year.");
  const parent = effectiveParentOf(effectiveParents, me);
  const siblings = cats.filter((c) => effectiveParentOf(effectiveParents, c) === parent);
  const from = siblings.findIndex((c) => c.id === categoryId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= siblings.length) return false;
  return reorderCategoryTo(categoryId, to, year);
}

export type CategoryTreeNode = {
  id: number;
  name: string;
  groupName: string | null;
  isAnnual: boolean;
  annualMonth: number | null;
  dueDay: number | null;
  linkedDebtPersonId: number | null;
  linkedBucketId: number | null;
  children: CategoryTreeNode[];
};

/** Lightweight structural view of categories (no months/amounts) for the
 * Settings page - just the tree shape, for rename/regroup/archive/move.
 * Uses the current calendar year's effective grouping (Settings manages
 * the live app, not a historical view) - see resolveEffectiveParents. */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  const currentYear = new Date().getFullYear();
  const cats = await db.query.categories.findMany({
    where: isNull(categories.archivedAt),
    orderBy: (c, { asc }) => [asc(c.sortOrder)],
  });
  const moves = await db.select().from(categoryParentMoves);
  const effectiveParents = resolveEffectiveParents(cats, moves, currentYear);

  const childrenByParent = groupChildrenByParent(cats, effectiveParents);
  return cats
    .filter((c) => effectiveParentOf(effectiveParents, c) === null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      groupName: c.groupName,
      isAnnual: c.isAnnual,
      annualMonth: c.annualMonth,
      dueDay: c.dueDay,
      linkedDebtPersonId: c.linkedDebtPersonId,
      linkedBucketId: c.linkedBucketId,
      children: (childrenByParent.get(c.id) ?? []).map((child) => ({
        id: child.id,
        name: child.name,
        groupName: child.groupName,
        isAnnual: child.isAnnual,
        annualMonth: child.annualMonth,
        dueDay: child.dueDay,
        linkedDebtPersonId: child.linkedDebtPersonId,
        linkedBucketId: child.linkedBucketId,
        children: [],
      })),
    }));
}
