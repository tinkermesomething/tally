import { describe, expect, it } from "vitest";
import { allowedHostFrom, checkProfile, parseAllowedHosts } from "@/lib/auth-rules";

describe("parseAllowedHosts", () => {
  it("splits, trims, lowercases, drops empties", () => {
    expect(parseAllowedHosts("Tally.Home.Internal, tally.example.com ,,")).toEqual(["tally.home.internal", "tally.example.com"]);
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts("")).toEqual([]);
  });
});

describe("allowedHostFrom", () => {
  const hosts = ["tally.home.internal", "tally.example.com"];
  it("passes through a listed host, case-insensitively", () => {
    expect(allowedHostFrom("tally.home.internal", hosts)).toBe("tally.home.internal");
    expect(allowedHostFrom("TALLY.HOME.INTERNAL", hosts)).toBe("tally.home.internal");
  });
  it("refuses anything not on the list - never echoes an arbitrary Host back", () => {
    expect(allowedHostFrom("evil.example.com", hosts)).toBeUndefined();
    expect(allowedHostFrom(null, hosts)).toBeUndefined();
    expect(allowedHostFrom(undefined, hosts)).toBeUndefined();
  });
});

describe("checkProfile", () => {
  it("refuses a missing sub claim outright - nothing to key a database file on", () => {
    const r = checkProfile({ email: "sam@example.com" });
    expect(r.ok).toBe(false);
    expect(r.auditDetail).toMatch(/no sub claim/);
  });
  it("refuses an explicitly-unverified email even if a sub is present", () => {
    const r = checkProfile({ sub: "sam-sub", email: "sam@example.com", email_verified: false });
    expect(r.ok).toBe(false);
    expect(r.auditDetail).toMatch(/not verified/);
  });
  it("accepts when the provider sends no verified claim at all", () => {
    expect(checkProfile({ sub: "sam-sub", email: "sam@example.com" }).ok).toBe(true);
  });
  it("accepts a verified profile with a sub", () => {
    expect(checkProfile({ sub: "sam-sub", email: "sam@example.com", email_verified: true })).toMatchObject({ ok: true, auditDetail: "sam@example.com" });
  });
  it("refuses undefined outright", () => {
    expect(checkProfile(undefined).ok).toBe(false);
  });
});
