import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { syncAllBankAccounts } from "@/lib/db/bank-sync";

// POST - fetches new transactions for every active bank account and stages
// them (see syncBankAccount in lib/db/bank-sync.ts). Not automatic yet -
// nothing was calling this pipeline at all before, so this is also the
// manual trigger a cron job would hit.
export const POST = apiRoute(async () => {
  const results = await syncAllBankAccounts();
  return NextResponse.json({ results });
});
