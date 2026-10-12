import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import {
  addAsset,
  addValuation,
  archiveAsset,
  deleteValuation,
  getArchivedAssets,
  getAsset,
  getAssetsWithValue,
  getAssetValuationHistory,
  getAssetValueTrend,
  renameAsset,
  setAssetColor,
  unarchiveAsset,
} from "@/lib/db/assets";

beforeEach(() => resetDb());

describe("assets", () => {
  it("is created together with its first valuation - never zero valuations", async () => {
    const asset = await addAsset({ name: "ISA", type: "investment", entryDate: "2026-01-01", valuePence: 500_00 });
    const history = await getAssetValuationHistory(asset.id);
    expect(history).toHaveLength(1);
    expect(history[0].valuePence).toBe(500_00);
  });

  it("rejects an empty name, a too-long name, and a negative value", async () => {
    await expect(addAsset({ name: "  ", type: "cash", entryDate: "2026-01-01", valuePence: 100 })).rejects.toThrow("Give it a name.");
    await expect(addAsset({ name: "x".repeat(81), type: "cash", entryDate: "2026-01-01", valuePence: 100 })).rejects.toThrow(/under 80/);
    await expect(addAsset({ name: "Car", type: "vehicle", entryDate: "2026-01-01", valuePence: -1 })).rejects.toThrow("Value can't be negative.");
  });

  it("rejects an unrecognized type", async () => {
    // @ts-expect-error - deliberately invalid at the type level too
    await expect(addAsset({ name: "Car", type: "business", entryDate: "2026-01-01", valuePence: 100 })).rejects.toThrow(/Unrecognized asset type/);
  });

  it("rename and colour follow the same validation as renamePerson/setPersonColor", async () => {
    const asset = await addAsset({ name: "Car", type: "vehicle", entryDate: "2026-01-01", valuePence: 1000_00 });
    await renameAsset(asset.id, "  The car  ");
    await setAssetColor(asset.id, "#1a2b3c");
    const [withValue] = await getAssetsWithValue();
    expect(withValue.name).toBe("The car");
    expect(withValue.color).toBe("#1a2b3c");

    await expect(renameAsset(asset.id, "")).rejects.toThrow("Give it a name.");
    await expect(setAssetColor(asset.id, "red")).rejects.toThrow(/#1a2b3c/);
    await expect(renameAsset(999, "x")).rejects.toThrow("no longer exists");
  });

  it("addValuation appends - current value is always the latest by date", async () => {
    const asset = await addAsset({ name: "ISA", type: "investment", entryDate: "2026-01-01", valuePence: 1000_00 });
    await addValuation(asset.id, { entryDate: "2026-03-01", valuePence: 1200_00 });
    const [withValue] = await getAssetsWithValue();
    expect(withValue.valuePence).toBe(1200_00);
    expect(withValue.valuedAt).toBe("2026-03-01");
    const history = await getAssetValuationHistory(asset.id);
    expect(history).toHaveLength(2);
  });

  it("refuses to delete an asset's only valuation", async () => {
    const asset = await addAsset({ name: "ISA", type: "investment", entryDate: "2026-01-01", valuePence: 1000_00 });
    const [only] = await getAssetValuationHistory(asset.id);
    await expect(deleteValuation(only.id)).rejects.toThrow(/at least one value/);
  });

  it("deleting a non-only valuation is fine", async () => {
    const asset = await addAsset({ name: "ISA", type: "investment", entryDate: "2026-01-01", valuePence: 1000_00 });
    await addValuation(asset.id, { entryDate: "2026-02-01", valuePence: 1100_00 });
    const [first] = await getAssetValuationHistory(asset.id);
    await deleteValuation(first.id);
    expect(await getAssetValuationHistory(asset.id)).toHaveLength(1);
  });

  it("archiving hides it from getAssetsWithValue but keeps it findable by id", async () => {
    const asset = await addAsset({ name: "Car", type: "vehicle", entryDate: "2026-01-01", valuePence: 500_00 });
    await archiveAsset(asset.id);
    expect(await getAssetsWithValue()).toHaveLength(0);
    expect(await getArchivedAssets()).toHaveLength(1);
    expect((await getAsset(asset.id))?.name).toBe("Car");
    await unarchiveAsset(asset.id);
    expect(await getAssetsWithValue()).toHaveLength(1);
  });

  it("the value trend forward-fills each asset across the merged timeline", async () => {
    const a = await addAsset({ name: "Cash", type: "cash", entryDate: "2026-01-01", valuePence: 100_00 });
    await addAsset({ name: "ISA", type: "investment", entryDate: "2026-01-15", valuePence: 200_00 });
    await addValuation(a.id, { entryDate: "2026-02-01", valuePence: 150_00 });
    // b has no valuation on 2026-02-01 - its 200_00 from 2026-01-15 should carry forward.
    const trend = await getAssetValueTrend();
    expect(trend).toEqual([
      { entryDate: "2026-01-01", totalPence: 100_00 },
      { entryDate: "2026-01-15", totalPence: 300_00 },
      { entryDate: "2026-02-01", totalPence: 350_00 },
    ]);
  });

  it("an archived asset drops out of the trend entirely", async () => {
    const a = await addAsset({ name: "Cash", type: "cash", entryDate: "2026-01-01", valuePence: 100_00 });
    await addAsset({ name: "ISA", type: "investment", entryDate: "2026-01-15", valuePence: 200_00 });
    await archiveAsset(a.id);
    const trend = await getAssetValueTrend();
    expect(trend).toEqual([{ entryDate: "2026-01-15", totalPence: 200_00 }]);
  });
});
