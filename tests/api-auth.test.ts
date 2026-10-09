import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { auditLog } from "@/lib/db/schema";
import { resetRateLimits } from "@/lib/rate-limit";
import { requireApiToken } from "@/lib/api-auth";
import { getSystemConn } from "@/lib/db/system-connection";

const req = (headers: Record<string, string> = {}, path = "http://x/api/v1/grid") => new Request(path, { headers });

beforeEach(() => {
  resetDb();
  resetRateLimits();
});

describe("requireApiToken", () => {
  it("accepts the right token", () => {
    process.env.TALLY_API_TOKEN = "test-token";
    expect(requireApiToken(req({ authorization: "Bearer test-token" }))).toBeNull();
  });

  it("refuses a missing or wrong token with 401, and records it", async () => {
    process.env.TALLY_API_TOKEN = "test-token";
    const res = requireApiToken(req({ authorization: "Bearer wrong" }, "http://x/api/v1/expenses"))!;
    expect(res.status).toBe(401);
    expect((await getSystemConn().db.select().from(auditLog))[0]).toMatchObject({ action: "api_token_rejected", detail: "/api/v1/expenses" });
  });

  it("503s when no token is configured at all (fails closed)", () => {
    delete process.env.TALLY_API_TOKEN;
    const res = requireApiToken(req({ authorization: "Bearer anything" }))!;
    expect(res.status).toBe(503);
  });

  it("rate-limits repeated failures from the same IP, independent of other IPs", () => {
    process.env.TALLY_API_TOKEN = "test-token";
    for (let i = 0; i < 20; i++) {
      const res = requireApiToken(req({ authorization: "Bearer wrong", "x-forwarded-for": "1.1.1.1" }));
      expect(res!.status).toBe(401);
    }
    expect(requireApiToken(req({ authorization: "Bearer wrong", "x-forwarded-for": "1.1.1.1" }))!.status).toBe(429);
    // a DIFFERENT client is unaffected
    expect(requireApiToken(req({ authorization: "Bearer test-token", "x-forwarded-for": "2.2.2.2" }))).toBeNull();
  });

  it("a right token after many wrong ones still works (limit is on attempts, not a lockout)", () => {
    process.env.TALLY_API_TOKEN = "test-token";
    for (let i = 0; i < 5; i++) requireApiToken(req({ authorization: "Bearer wrong", "x-forwarded-for": "3.3.3.3" }));
    expect(requireApiToken(req({ authorization: "Bearer test-token", "x-forwarded-for": "3.3.3.3" }))).toBeNull();
  });
});
