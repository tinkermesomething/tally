import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { syncAllBankAccounts } from "@/lib/db/bank-sync";

// POST - fetches new transactions for every active bank account and stages
// them (see syncBankAccount in lib/db/bank-sync.ts). The in-process
// scheduler (lib/scheduled-sync.ts) runs the same pass on a timer; this is
// the manual trigger. If a pass is already running, this joins it rather
// than starting another (see syncAllBankAccounts).
export const POST = apiRoute(async () => {
  const results = await syncAllBankAccounts();
  return NextResponse.json({ results });
});
