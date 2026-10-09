"use server";

import { toResult } from "@/lib/action-result";
import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import {
  createReportPanel as createReportPanelQuery,
  updateReportPanel as updateReportPanelQuery,
  deleteReportPanel as deleteReportPanelQuery,
  type ReportPanelPick,
} from "@/lib/db/queries";

export async function createReportPanel(name: string, selection: ReportPanelPick[]) {
  return requireSession(() =>
    toResult(async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name can't be empty.");
      if (selection.length === 0) throw new Error("Pick at least one group or category.");
      await createReportPanelQuery(trimmed, selection);
      revalidatePath("/reports");
    })
  );
}

export async function updateReportPanel(
  id: number,
  input: { name?: string; selection?: ReportPanelPick[] }
) {
  return requireSession(() =>
    toResult(async () => {
      const name = input.name !== undefined ? input.name.trim() : undefined;
      if (name !== undefined && !name) throw new Error("Name can't be empty.");
      if (input.selection !== undefined && input.selection.length === 0) {
        throw new Error("Pick at least one group or category.");
      }
      await updateReportPanelQuery(id, { ...input, name });
      revalidatePath("/reports");
    })
  );
}

export async function deleteReportPanel(id: number) {
  return requireSession(async () => {
    await deleteReportPanelQuery(id);
    revalidatePath("/reports");
  });
}
