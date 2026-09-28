import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
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
  if (typeof body.year !== "number" || typeof body.month !== "number") {
    return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  }
  if (body.month < 0 || body.month > 11) {
    return NextResponse.json({ error: "month must be 0-11" }, { status: 400 });
  }
  if (typeof body.pounds !== "number" || body.pounds < 0) {
    return NextResponse.json({ error: "pounds must be a non-negative number" }, { status: 400 });
  }
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
  if (typeof body.year !== "number" || typeof body.month !== "number") {
    return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  }
  if (body.month < 0 || body.month > 11) {
    return NextResponse.json({ error: "month must be 0-11" }, { status: 400 });
  }
  await setCategoryEntryPaid({
    categoryId,
    year: body.year,
    month: body.month,
    paid: !!body.paid,
  });
  return NextResponse.json({ ok: true });
});
