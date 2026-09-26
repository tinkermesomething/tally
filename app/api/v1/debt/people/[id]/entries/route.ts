import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { addDebtEntry } from "@/lib/db/debt";
import { poundsToPence } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

// POST { pounds, entryDate: "YYYY-MM-DD", direction: "loan"|"repayment", note? }
export const POST = apiRoute<Ctx>(async (request, { params }) => {
  const { id } = await params;
  const body = await request.json();
  if (!(body.pounds > 0)) {
    return NextResponse.json({ error: "pounds must be greater than zero" }, { status: 400 });
  }
  if (body.direction !== "loan" && body.direction !== "repayment") {
    return NextResponse.json(
      { error: 'direction must be "loan" or "repayment"' },
      { status: 400 }
    );
  }
  await addDebtEntry({
    personId: parseInt(id, 10),
    entryDate: body.entryDate,
    amountPence: poundsToPence(body.pounds),
    direction: body.direction,
    note: body.note,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});
