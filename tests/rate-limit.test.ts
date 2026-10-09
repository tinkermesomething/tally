import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, resetRateLimits } from "@/lib/rate-limit";

beforeEach(() => resetRateLimits());

describe("checkRateLimit", () => {
  it("allows up to max, then refuses within the same window", () => {
    const now = 1_000_000;
    expect(checkRateLimit("k", 3, 60_000, now)).toMatchObject({ allowed: true, remaining: 2 });
    expect(checkRateLimit("k", 3, 60_000, now)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkRateLimit("k", 3, 60_000, now)).toMatchObject({ allowed: true, remaining: 0 });
    expect(checkRateLimit("k", 3, 60_000, now)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("resets once the window has passed", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("k", 3, 1000, now);
    expect(checkRateLimit("k", 3, 1000, now).allowed).toBe(false);
    expect(checkRateLimit("k", 3, 1000, now + 1001)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("keeps keys independent", () => {
    checkRateLimit("a", 1, 1000, 0);
    expect(checkRateLimit("a", 1, 1000, 0).allowed).toBe(false);
    expect(checkRateLimit("b", 1, 1000, 0).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("prefers x-forwarded-for, takes the first hop", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
