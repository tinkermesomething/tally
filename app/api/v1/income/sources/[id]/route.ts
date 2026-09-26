import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { archiveIncomeSource } from "@/lib/db/queries";

type Ctx = { params: Promise<{ id: string }> };

// DELETE - soft-delete; past entries are preserved, just hidden going forward.
export const DELETE = apiRoute<Ctx>(async (_request, { params }) => {
  const { id } = await params;
  await archiveIncomeSource(parseInt(id, 10));
  return NextResponse.json({ ok: true });
});
