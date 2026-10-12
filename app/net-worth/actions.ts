"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { poundsToPence } from "@/lib/money";
import { assertNonNegativePounds } from "@/lib/validate";
import {
  addAsset as addAssetQuery,
  addValuation as addValuationQuery,
  archiveAsset as archiveAssetQuery,
  deleteValuation as deleteValuationQuery,
  renameAsset as renameAssetQuery,
  setAssetColor as setAssetColorQuery,
  unarchiveAsset as unarchiveAssetQuery,
  type AssetType,
} from "@/lib/db/assets";

export async function createAsset(input: { name: string; type: AssetType; entryDate: string; pounds: number }) {
  return requireSession(async () => {
    assertNonNegativePounds(input.pounds);
    const asset = await addAssetQuery({ name: input.name, type: input.type, entryDate: input.entryDate, valuePence: poundsToPence(input.pounds) });
    revalidatePath("/net-worth");
    return asset;
  });
}

export async function renameAsset(id: number, name: string) {
  return requireSession(async () => {
    await renameAssetQuery(id, name);
    revalidatePath("/net-worth");
  });
}

export async function setAssetColor(id: number, color: string | null) {
  return requireSession(async () => {
    await setAssetColorQuery(id, color);
    revalidatePath("/net-worth");
  });
}

export async function addAssetValuation(assetId: number, input: { entryDate: string; pounds: number }) {
  return requireSession(async () => {
    assertNonNegativePounds(input.pounds);
    await addValuationQuery(assetId, { entryDate: input.entryDate, valuePence: poundsToPence(input.pounds) });
    revalidatePath("/net-worth");
  });
}

export async function removeAssetValuation(id: number) {
  return requireSession(async () => {
    await deleteValuationQuery(id);
    revalidatePath("/net-worth");
  });
}

export async function removeAsset(id: number) {
  return requireSession(async () => {
    await archiveAssetQuery(id);
    revalidatePath("/net-worth");
  });
}

export async function restoreAsset(id: number) {
  return requireSession(async () => {
    await unarchiveAssetQuery(id);
    revalidatePath("/net-worth");
  });
}
