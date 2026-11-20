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

  it("echoes the launcher's nonce when one is set (desktop readiness handshake)", async () => {
    resetDb();
    process.env.HEALTH_NONCE = "abc123";
    try {
      expect(await GET().json()).toEqual({ ok: true, nonce: "abc123" });
    } finally {
      delete process.env.HEALTH_NONCE;
    }
  });
});
