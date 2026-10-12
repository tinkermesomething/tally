import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, inTransaction } from "./index";
import { assertIsoDate } from "../validate";
import { assets, assetValuations } from "./schema";

export const ASSET_TYPES = ["cash", "investment", "property", "vehicle", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export type AssetWithValue = {
  id: number;
  name: string;
  type: AssetType;
  color: string | null;
  note: string | null;
  archived: boolean;
  valuePence: number;
  valuedAt: string | null;
};

export type ValuationRow = { id: number; entryDate: string; valuePence: number };

const MAX_NAME = 80;
const MAX_NOTE = 300;

function assertValidType(type: string): asserts type is AssetType {
  if (!(ASSET_TYPES as readonly string[]).includes(type)) throw new Error(`Unrecognized asset type: "${type}"`);
}

function assertValidValue(pence: number) {
  if (!Number.isInteger(pence) || pence < 0) throw new Error("Value can't be negative.");
}

/** Creates an asset together with its first valuation, in one transaction -
 * an asset is never left with zero valuations (see assets' own schema
 * comment on why there's no separate valuePence column to default). */
export async function addAsset(input: { name: string; type: AssetType; color?: string | null; note?: string | null; entryDate: string; valuePence: number }) {
  const name = input.name.trim();
  if (!name) throw new Error("Give it a name.");
  if (name.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`);
  assertValidType(input.type);
  assertIsoDate(input.entryDate);
  assertValidValue(input.valuePence);
  const note = input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;
  return inTransaction(async () => {
    const [created] = await db.insert(assets).values({ name, type: input.type, color: input.color?.trim() || null, note }).returning();
    await db.insert(assetValuations).values({ assetId: created.id, entryDate: input.entryDate, valuePence: input.valuePence });
    return created;
  });
}

/** Same validation as renamePerson (lib/db/debt.ts). */
export async function renameAsset(id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give it a name.");
  if (trimmed.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`);
  const updated = await db.update(assets).set({ name: trimmed }).where(eq(assets.id, id)).returning({ id: assets.id });
  if (updated.length === 0) throw new Error("That asset no longer exists.");
}

/** Same "#rrggbb" validation as setPersonColor (lib/db/debt.ts). */
export async function setAssetColor(id: number, color: string | null) {
  const value = color === null || color === "" ? null : color.trim();
  if (value !== null && !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("Colour must look like #1a2b3c.");
  const updated = await db.update(assets).set({ color: value }).where(eq(assets.id, id)).returning({ id: assets.id });
  if (updated.length === 0) throw new Error("That asset no longer exists.");
}

/** Appends a new valuation - the only way an asset's value changes (no
 * in-place edit), so the trend chart is always real history. */
export async function addValuation(assetId: number, input: { entryDate: string; valuePence: number }) {
  assertIsoDate(input.entryDate);
  assertValidValue(input.valuePence);
  const asset = await db.query.assets.findFirst({ where: eq(assets.id, assetId) });
  if (!asset) throw new Error("That asset no longer exists.");
  await db.insert(assetValuations).values({ assetId, entryDate: input.entryDate, valuePence: input.valuePence });
}

/** Refuses to remove an asset's only valuation - it would leave the asset
 * with no value at all, a state addAsset never allows it to start in. */
export async function deleteValuation(id: number) {
  const row = await db.query.assetValuations.findFirst({ where: eq(assetValuations.id, id) });
  if (!row) return;
  const siblings = await db.select({ id: assetValuations.id }).from(assetValuations).where(eq(assetValuations.assetId, row.assetId));
  if (siblings.length <= 1) throw new Error("Every asset needs at least one value - add a new one before removing this.");
  await db.delete(assetValuations).where(eq(assetValuations.id, id));
}

export async function archiveAsset(id: number) {
  await db.update(assets).set({ archived: true }).where(eq(assets.id, id));
}

export async function unarchiveAsset(id: number) {
  await db.update(assets).set({ archived: false }).where(eq(assets.id, id));
}

export async function getArchivedAssets() {
  return db.query.assets.findMany({ where: eq(assets.archived, true), orderBy: (a, { asc }) => [asc(a.name)] });
}

/** Every active asset with its latest valuation - one query for all
 * valuations (not one per asset), latest-per-asset picked in JS since the
 * dataset here is always small (a household's own assets, not a ledger). */
export async function getAssetsWithValue(): Promise<AssetWithValue[]> {
  const active = await db.query.assets.findMany({ where: eq(assets.archived, false), orderBy: (a, { asc }) => [asc(a.id)] });
  if (active.length === 0) return [];
  const ids = active.map((a) => a.id);
  const rows = await db
    .select()
    .from(assetValuations)
    .where(inArray(assetValuations.assetId, ids))
    .orderBy(desc(assetValuations.entryDate), desc(assetValuations.id));
  const latest = new Map<number, { valuePence: number; entryDate: string }>();
  for (const r of rows) if (!latest.has(r.assetId)) latest.set(r.assetId, { valuePence: r.valuePence, entryDate: r.entryDate });
  return active.map((a) => ({
    ...a,
    type: a.type as AssetType,
    valuePence: latest.get(a.id)?.valuePence ?? 0,
    valuedAt: latest.get(a.id)?.entryDate ?? null,
  }));
}

export async function getAsset(id: number): Promise<{ id: number; name: string; type: AssetType; color: string | null } | null> {
  const row = await db.query.assets.findFirst({ where: eq(assets.id, id) });
  return row ? { id: row.id, name: row.name, type: row.type as AssetType, color: row.color } : null;
}

export async function getAssetValuationHistory(assetId: number): Promise<ValuationRow[]> {
  return db
    .select({ id: assetValuations.id, entryDate: assetValuations.entryDate, valuePence: assetValuations.valuePence })
    .from(assetValuations)
    .where(eq(assetValuations.assetId, assetId))
    .orderBy(asc(assetValuations.entryDate), asc(assetValuations.id));
}

/** Total asset value at every date any asset was (re)valued, forward-filling
 * each asset's own latest-known value across the merged timeline - the
 * basis for the "assets over time" trend chart. Archived assets are
 * excluded entirely (same as getAssetsWithValue), so selling/retiring one
 * doesn't leave a permanent, unexplained step down in the trend. */
export async function getAssetValueTrend(): Promise<{ entryDate: string; totalPence: number }[]> {
  const active = await db.query.assets.findMany({ where: eq(assets.archived, false) });
  if (active.length === 0) return [];
  const ids = active.map((a) => a.id);
  const rows = await db
    .select()
    .from(assetValuations)
    .where(inArray(assetValuations.assetId, ids))
    .orderBy(asc(assetValuations.entryDate), asc(assetValuations.id));
  const dates = [...new Set(rows.map((r) => r.entryDate))].sort();
  const latestByAsset = new Map<number, number>();
  const result: { entryDate: string; totalPence: number }[] = [];
  let idx = 0;
  for (const date of dates) {
    while (idx < rows.length && rows[idx].entryDate === date) {
      latestByAsset.set(rows[idx].assetId, rows[idx].valuePence);
      idx++;
    }
    result.push({ entryDate: date, totalPence: [...latestByAsset.values()].reduce((sum, v) => sum + v, 0) });
  }
  return result;
}
