import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { upsertIncomeEntry } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

// PUT { incomeSourceId, year, month, pounds }
export const PUT = apiRoute(async (request) => {
  const body = await request.json();
  if (typeof body.incomeSourceId !== "number") {
    return NextResponse.json({ error: "incomeSourceId is required" }, { status: 400 });
  }
  if (typeof body.year !== "number" || typeof body.month !== "number") {
    return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  }
  if (body.month < 0 || body.month > 11) {
    return NextResponse.json({ error: "month must be 0-11" }, { status: 400 });
  }
  if (typeof body.pounds !== "number" || body.pounds < 0) {
    return NextResponse.json({ error: "pounds must be a non-negative number" }, { status: 400 });
  }
  await upsertIncomeEntry({
    incomeSourceId: body.incomeSourceId,
    year: body.year,
    month: body.month,
    amountPence: poundsToPence(body.pounds),
  });
  return NextResponse.json({ ok: true });
});
