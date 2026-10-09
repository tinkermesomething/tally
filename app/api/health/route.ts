import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { enterUserDb } from "@/lib/db/context";
import { getLegacyConn } from "@/lib/db/legacy-connection";

// Public on purpose (no token): a container health check can't hold one.
// Says nothing but whether the app can read its database. Not wrapped by
// apiRoute (that would require a token this caller can't have), so it
// establishes its own connection the same way apiRoute/requireSession do.
export const dynamic = "force-dynamic";

export function GET() {
  try {
    enterUserDb(getLegacyConn());
    sqlite.prepare("select 1").get();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health] database check failed:", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
