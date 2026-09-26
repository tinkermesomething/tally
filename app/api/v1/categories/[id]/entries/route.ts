import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { setCategoryEntryPaid, upsertCategoryEntry } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

// PUT { year, month, pounds } - sets/creates the planned amount for that month
export const PUT = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const body = await request.json();
  await upsertCategoryEntry({
    categoryId: parseInt(id, 10),
    year: body.year,
    month: body.month,
    amountPence: poundsToPence(body.pounds),
  });
  return NextResponse.json({ ok: true });
});

// PATCH { year, month, paid } - marks that month's entry paid/unpaid
export const PATCH = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const body = await request.json();
  await setCategoryEntryPaid({
    categoryId: parseInt(id, 10),
    year: body.year,
    month: body.month,
    paid: !!body.paid,
  });
  return NextResponse.json({ ok: true });
});
