import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { badRequest, checkYearMonth, isPounds } from "@/lib/api-validate";
import { upsertIncomeEntry } from "@/lib/db/queries";
import { poundsToPence } from "@/lib/money";

// PUT { incomeSourceId, year, month, pounds }
export const PUT = apiRoute(async (request) => {
  const body = await request.json();
  if (typeof body.incomeSourceId !== "number") {
    return NextResponse.json({ error: "incomeSourceId is required" }, { status: 400 });
  }
  const periodError = checkYearMonth(body);
  if (periodError) return badRequest(periodError);
  if (!isPounds(body.pounds, true)) return badRequest("pounds must be a non-negative number");
  await upsertIncomeEntry({
    incomeSourceId: body.incomeSourceId,
    year: body.year,
    month: body.month,
    amountPence: poundsToPence(body.pounds),
  });
  return NextResponse.json({ ok: true });
});
