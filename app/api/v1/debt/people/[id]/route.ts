import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { archivePerson, getPersonLedger } from "@/lib/db/debt";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, { params }) => {
  const { id } = await params;
  const ledger = await getPersonLedger(parseInt(id, 10));
  if (!ledger.person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }
  return NextResponse.json(ledger);
});

// DELETE - soft-delete; the ledger history is preserved, just hidden from
// the Debt page going forward.
export const DELETE = apiRoute<Ctx>(async (_request, { params }) => {
  const { id } = await params;
  await archivePerson(parseInt(id, 10));
  return NextResponse.json({ ok: true });
});
