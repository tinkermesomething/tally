import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-auth";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { syncAllBankAccounts } from "@/lib/db/bank-sync";

// GoCardless's own per-account daily call budget is the real limit (as low
// as 4-10/day); this just stops the endpoint itself being hammered well
// past any reasonable manual-trigger frequency, since syncAllBankAccounts's
// own in-flight dedupe only protects against CONCURRENT calls, not a burst
// of sequential ones.
const MAX_CALLS_PER_WINDOW = 10;
const WINDOW_MS = 60_000;

// POST - fetches new transactions for every active bank account and stages
// them (see syncBankAccount in lib/db/bank-sync.ts). The in-process
// scheduler (lib/scheduled-sync.ts) runs the same pass on a timer; this is
// the manual trigger. If a pass is already running, this joins it rather
// than starting another (see syncAllBankAccounts).
export const POST = apiRoute(async (request) => {
  const limit = checkRateLimit(`bank-sync:${clientIp(request)}`, MAX_CALLS_PER_WINDOW, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many sync requests. Try again shortly." }, { status: 429 });
  }
  const results = await syncAllBankAccounts();
  return NextResponse.json({ results });
});
