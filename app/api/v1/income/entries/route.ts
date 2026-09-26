import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { upsertIncomeEntry } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

// PUT { incomeSourceId, year, month, pounds }
export const PUT = apiRoute(async (request) => {
  const body = await request.json();
  await upsertIncomeEntry({
    incomeSourceId: body.incomeSourceId,
    year: body.year,
    month: body.month,
    amountPence: poundsToPence(body.pounds),
  });
  return NextResponse.json({ ok: true });
});
