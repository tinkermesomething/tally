import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { getExpenseEntriesForCell, getExpenseEntriesForMonth, logExpense } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

// GET ?year=&month=&categoryId= - month and categoryId both optional.
// categoryId narrows to one cell's entries; omitting it lists the whole
// month (or whole year, if month is also omitted) across every category.
export const GET = apiRoute(async (request) => {
  const url = new URL(request.url);
  const year = parseInt(url.searchParams.get("year") ?? "", 10);
  if (Number.isNaN(year)) {
    return NextResponse.json({ error: "year is required" }, { status: 400 });
  }
  const monthParam = url.searchParams.get("month");
  const categoryIdParam = url.searchParams.get("categoryId");

  if (categoryIdParam) {
    const categoryId = parseInt(categoryIdParam, 10);
    if (Number.isNaN(categoryId)) {
      return NextResponse.json({ error: "categoryId must be a valid number" }, { status: 400 });
    }
    if (!monthParam) {
      return NextResponse.json({ error: "month is required when categoryId is set" }, { status: 400 });
    }
    const month = parseInt(monthParam, 10);
    if (Number.isNaN(month)) {
      return NextResponse.json({ error: "month must be a valid number" }, { status: 400 });
    }
    const entries = await getExpenseEntriesForCell(categoryId, year, month);
    return NextResponse.json({ entries });
  }

  let month: number | undefined;
  if (monthParam) {
    month = parseInt(monthParam, 10);
    if (Number.isNaN(month)) {
      return NextResponse.json({ error: "month must be a valid number" }, { status: 400 });
    }
  }
  const entries = await getExpenseEntriesForMonth(year, month);
  return NextResponse.json({ entries });
});

// POST { categoryId, pounds, entryDate: "YYYY-MM-DD", note? }
export const POST = apiRoute(async (request) => {
  const body = await request.json();
  if (typeof body.categoryId !== "number") {
    return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
  }
  if (typeof body.entryDate !== "string" || !body.entryDate) {
    return NextResponse.json({ error: "entryDate is required" }, { status: 400 });
  }
  if (typeof body.pounds !== "number" || body.pounds <= 0) {
    return NextResponse.json({ error: "pounds must be a number greater than zero" }, { status: 400 });
  }
  await logExpense({
    categoryId: body.categoryId,
    amountPence: poundsToPence(body.pounds),
    entryDate: body.entryDate,
    note: body.note,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});
