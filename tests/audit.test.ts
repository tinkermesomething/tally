import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { auditLog } from "@/lib/db/schema";
import { audit, pruneAuditLog } from "@/lib/audit";
import { getSystemConn } from "@/lib/db/system-connection";

beforeEach(() => resetDb());

describe("audit log", () => {
  it("records an action with optional detail and ip", async () => {
    await audit("sign_in", "sam@example.com", "1.2.3.4");
    const rows = await getSystemConn().db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "sign_in", detail: "sam@example.com", ip: "1.2.3.4" });
  });

  it("detail and ip are optional", async () => {
    await audit("startup");
    expect((await getSystemConn().db.select().from(auditLog))[0]).toMatchObject({ detail: null, ip: null });
  });

  it("prunes rows older than 180 days, keeps the rest", async () => {
    // Real SQLite datetime() values, not JS toISOString() strings - the
    // actual format `at`'s own column default produces (space-separated,
    // no "T"/milliseconds/"Z") is a DIFFERENT string shape, and comparing
    // the two shapes lexicographically doesn't always agree with comparing
    // two of the same shape (confirmed directly) - this is exactly the gap
    // an all-toISOString() test would miss.
    await getSystemConn().db.insert(auditLog).values([
      { action: "old_one", at: sql`datetime('now', '-200 days')` },
      { action: "recent_one", at: sql`datetime('now', '-1 days')` },
    ]);
    await pruneAuditLog();
    const rows = await getSystemConn().db.select().from(auditLog);
    expect(rows.map((r) => r.action)).toEqual(["recent_one"]);
  });

  it("a row from right now (the real default, not a hand-picked timestamp) is never pruned", async () => {
    await audit("sign_in", "sam@example.com");
    await pruneAuditLog();
    expect(await getSystemConn().db.select().from(auditLog)).toHaveLength(1);
  });
});
