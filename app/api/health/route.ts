import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";

// Public on purpose (no token): a container health check can't hold one.
// Says nothing but whether the app can read its database.
export const dynamic = "force-dynamic";

export function GET() {
  try {
    sqlite.prepare("select 1").get();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health] database check failed:", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
