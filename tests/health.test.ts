import { describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { GET } from "@/app/api/health/route";

describe("/api/health", () => {
  it("is 200 and token-free when the database answers", async () => {
    resetDb();
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
