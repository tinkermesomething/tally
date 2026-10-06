"use server";

import { revalidatePath } from "next/cache";
import { toResult, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/lib/session";
import { assertNonNegativePounds, assertPositivePounds } from "@/lib/validate";
import { poundsToPence } from "@/lib/money";
import {
  addBucket,
  addSavingsEntry,
  archiveBucket,
  deleteSavingsEntry,
  linkCategoryToBucket,
  unarchiveBucket,
  updateBucket,
  updateSavingsEntry,
} from "@/lib/db/savings";

export type BucketForm = {
  name: string;
  color?: string | null;
  goalPounds?: number | null;
  goalDate?: string | null;
  openingPounds?: number | null;
  note?: string | null;
};

function toBucketInput(f: BucketForm) {
  if (f.goalPounds != null) assertPositivePounds(f.goalPounds, "The goal must be more than zero.");
  if (f.openingPounds != null) assertNonNegativePounds(f.openingPounds, "The opening balance can't be negative.");
  return {
    name: f.name,
    color: f.color ?? null,
    goalPence: f.goalPounds != null ? poundsToPence(f.goalPounds) : null,
    goalDate: f.goalDate || null,
    openingPence: f.openingPounds != null ? poundsToPence(f.openingPounds) : 0,
    note: f.note ?? null,
  };
}

function refresh(bucketId?: number) {
  revalidatePath("/savings");
  if (bucketId !== undefined) revalidatePath(`/savings/${bucketId}`);
  revalidatePath("/settings");
}

export async function createBucket(form: BucketForm): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    await addBucket(toBucketInput(form));
    refresh();
  });
}

export async function editBucket(id: number, form: BucketForm): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    await updateBucket(id, toBucketInput(form));
    refresh(id);
  });
}

export async function removeBucket(id: number) {
  await requireSession();
  await archiveBucket(id);
  refresh(id);
}

export async function restoreBucket(id: number) {
  await requireSession();
  await unarchiveBucket(id);
  refresh(id);
}

export async function addEntry(input: {
  bucketId: number;
  pounds: number;
  entryDate: string;
  direction: "deposit" | "withdrawal";
  note?: string;
}): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    assertPositivePounds(input.pounds);
    await addSavingsEntry({
      bucketId: input.bucketId,
      entryDate: input.entryDate,
      amountPence: poundsToPence(input.pounds),
      direction: input.direction,
      note: input.note,
    });
    refresh(input.bucketId);
  });
}

export async function editEntry(
  bucketId: number,
  id: number,
  input: { pounds?: number; direction?: "deposit" | "withdrawal"; entryDate?: string; note?: string }
): Promise<ActionResult> {
  await requireSession();
  return toResult(async () => {
    if (input.pounds !== undefined) assertPositivePounds(input.pounds);
    await updateSavingsEntry(id, {
      amountPence: input.pounds !== undefined ? poundsToPence(input.pounds) : undefined,
      direction: input.direction,
      entryDate: input.entryDate,
      note: input.note,
    });
    refresh(bucketId);
  });
}

export async function removeEntry(bucketId: number, id: number) {
  await requireSession();
  await deleteSavingsEntry(id);
  refresh(bucketId);
}

/** Links (or unlinks, with null) a category to a bucket. Resolves with how
 * many past expenses were added when a back-fill date was given. */
export async function linkCategory(
  categoryId: number,
  bucketId: number | null,
  backfillFrom?: string
): Promise<ActionResult & { added?: number }> {
  await requireSession();
  let added = 0;
  const result = await toResult(async () => {
    added = await linkCategoryToBucket(categoryId, bucketId, { backfillFrom: backfillFrom || undefined });
    refresh();
  });
  return result.ok ? { ok: true, added } : result;
}
