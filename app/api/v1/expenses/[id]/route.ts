import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { badRequest, isPounds } from "@/lib/api-validate";
import { updateExpenseEntry, deleteExpenseEntry } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { pounds?, note?, entryDate? }
export const PATCH = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const body = await request.json();
  if (body.pounds !== undefined && !isPounds(body.pounds)) return badRequest("pounds must be a number greater than zero");
  await updateExpenseEntry(parseInt(id, 10), {
    amountPence: body.pounds !== undefined ? poundsToPence(body.pounds) : undefined,
    note: body.note !== undefined ? body.note || null : undefined,
    entryDate: body.entryDate,
  });
  return NextResponse.json({ ok: true });
});

// DELETE - permanent, not a soft-delete (see deleteExpenseEntry).
export const DELETE = apiRoute<Ctx>(async (_request, { params }) => {
  const { id } = await params;
  await deleteExpenseEntry(parseInt(id, 10));
  return NextResponse.json({ ok: true });
});
