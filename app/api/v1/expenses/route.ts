import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { logExpense } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

// POST { categoryId, pounds, entryDate: "YYYY-MM-DD", note? }
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (!(body.pounds > 0)) {
    return NextResponse.json({ error: "pounds must be greater than zero" }, { status: 400 });
  }
  await logExpense({
    categoryId: body.categoryId,
    amountPence: poundsToPence(body.pounds),
    entryDate: body.entryDate,
    note: body.note,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});
