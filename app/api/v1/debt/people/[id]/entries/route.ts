import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { isPounds } from "@/lib/api-validate";
import { addDebtEntry } from "@/lib/db/debt";
import { poundsToPence } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

// POST { pounds, entryDate: "YYYY-MM-DD", direction: "loan"|"repayment", note? }
export const POST = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const personId = parseInt(id, 10);
  if (Number.isNaN(personId)) {
    return NextResponse.json({ error: "invalid person id" }, { status: 400 });
  }
  const body = await request.json();
  if (typeof body.entryDate !== "string" || !body.entryDate) {
    return NextResponse.json({ error: "entryDate is required" }, { status: 400 });
  }
  if (!isPounds(body.pounds)) {
    return NextResponse.json({ error: "pounds must be a number greater than zero" }, { status: 400 });
  }
  if (body.direction !== "loan" && body.direction !== "repayment") {
    return NextResponse.json(
      { error: 'direction must be "loan" or "repayment"' },
      { status: 400 }
    );
  }
  await addDebtEntry({
    personId,
    entryDate: body.entryDate,
    amountPence: poundsToPence(body.pounds),
    direction: body.direction,
    note: body.note,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});
