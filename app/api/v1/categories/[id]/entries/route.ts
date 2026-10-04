import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { badRequest, checkYearMonth, isPounds } from "@/lib/api-validate";
import { setCategoryEntryPaid, upsertCategoryEntry } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

// PUT { year, month, pounds } - sets/creates the planned amount for that month
export const PUT = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const categoryId = parseInt(id, 10);
  if (Number.isNaN(categoryId)) {
    return NextResponse.json({ error: "invalid category id" }, { status: 400 });
  }
  const body = await request.json();
  const periodError = checkYearMonth(body);
  if (periodError) return badRequest(periodError);
  if (!isPounds(body.pounds, true)) return badRequest("pounds must be a non-negative number");
  await upsertCategoryEntry({
    categoryId,
    year: body.year,
    month: body.month,
    amountPence: poundsToPence(body.pounds),
  });
  return NextResponse.json({ ok: true });
});

// PATCH { year, month, paid } - marks that month's entry paid/unpaid
export const PATCH = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const categoryId = parseInt(id, 10);
  if (Number.isNaN(categoryId)) {
    return NextResponse.json({ error: "invalid category id" }, { status: 400 });
  }
  const body = await request.json();
  const periodError = checkYearMonth(body);
  if (periodError) return badRequest(periodError);
  await setCategoryEntryPaid({
    categoryId,
    year: body.year,
    month: body.month,
    paid: !!body.paid,
  });
  return NextResponse.json({ ok: true });
});
