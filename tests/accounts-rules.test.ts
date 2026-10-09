import { describe, expect, it } from "vitest";
import { canDisable, checkInviteEmail, hasAdminGroup, isBootstrapAdminEmail, isEffectiveAdmin, resolveSignIn } from "@/lib/accounts-rules";

const ADMIN = "admin@example.com";

describe("isBootstrapAdminEmail", () => {
  it("matches the allowed email case-insensitively", () => {
    expect(isBootstrapAdminEmail("Admin@Example.com", ADMIN)).toBe(true);
    expect(isBootstrapAdminEmail("other@example.com", ADMIN)).toBe(false);
  });
  it("is false with nothing configured or no email", () => {
    expect(isBootstrapAdminEmail("admin@example.com", undefined)).toBe(false);
    expect(isBootstrapAdminEmail(undefined, ADMIN)).toBe(false);
  });
});

describe("resolveSignIn", () => {
  it("creates the bootstrap admin on its very first login", () => {
    const r = resolveSignIn(ADMIN, ADMIN, null, null);
    expect(r).toMatchObject({ allow: true, action: "create-admin" });
  });

  it("refuses an unknown, uninvited email", () => {
    const r = resolveSignIn("stranger@example.com", ADMIN, null, null);
    expect(r).toMatchObject({ allow: false, reason: "not-invited" });
  });

  it("signs in a known sub straight away, even if its email no longer matches anything special", () => {
    const r = resolveSignIn("changed@example.com", ADMIN, { oidcSub: "sub-1", disabledAt: null, isAdmin: false }, null);
    expect(r).toMatchObject({ allow: true, action: "sign-in" });
  });

  it("completes an invite (sub not yet known) found by email", () => {
    const r = resolveSignIn("invitee@example.com", ADMIN, null, { oidcSub: null, disabledAt: null, isAdmin: false });
    expect(r).toMatchObject({ allow: true, action: "complete-invite" });
  });

  it("a sub match wins over an email match when somehow both are given", () => {
    const bySub = { oidcSub: "sub-1", disabledAt: null, isAdmin: false };
    const byEmail = { oidcSub: null, disabledAt: null, isAdmin: false };
    expect(resolveSignIn("x@example.com", ADMIN, bySub, byEmail)).toMatchObject({ action: "sign-in" });
  });

  it("refuses a disabled account, whether matched by sub or by email", () => {
    const disabledBySub = { oidcSub: "sub-1", disabledAt: new Date(), isAdmin: false };
    expect(resolveSignIn("x@example.com", ADMIN, disabledBySub, null)).toMatchObject({ allow: false, reason: "disabled" });
    const disabledByEmail = { oidcSub: null, disabledAt: new Date(), isAdmin: false };
    expect(resolveSignIn("x@example.com", ADMIN, null, disabledByEmail)).toMatchObject({ allow: false, reason: "disabled" });
  });

  it("the bootstrap admin email itself still just signs in once their row exists (not re-created)", () => {
    const existing = { oidcSub: "admin-sub", disabledAt: null, isAdmin: true };
    expect(resolveSignIn(ADMIN, ADMIN, existing, null)).toMatchObject({ action: "sign-in" });
  });
});

describe("canDisable", () => {
  it("refuses to let the bootstrap admin disable themselves", () => {
    expect(canDisable({ email: ADMIN, isAdmin: true }, ADMIN)).toBe(false);
  });
  it("allows disabling anyone else, admin or not", () => {
    expect(canDisable({ email: "other@example.com", isAdmin: true }, ADMIN)).toBe(true);
    expect(canDisable({ email: "other@example.com", isAdmin: false }, ADMIN)).toBe(true);
  });
});

describe("hasAdminGroup", () => {
  it("true only when 'admin' is in the groups array", () => {
    expect(hasAdminGroup(["admin"])).toBe(true);
    expect(hasAdminGroup(["admin", "other"])).toBe(true);
    expect(hasAdminGroup(["other"])).toBe(false);
  });
  it("false for anything that isn't an array (missing claim, wrong shape)", () => {
    expect(hasAdminGroup(undefined)).toBe(false);
    expect(hasAdminGroup(null)).toBe(false);
    expect(hasAdminGroup("admin")).toBe(false);
  });
});

describe("isEffectiveAdmin", () => {
  it("true from the group claim alone, even for a non-bootstrap email", () => {
    expect(isEffectiveAdmin("other@example.com", ADMIN, ["admin"])).toBe(true);
  });
  it("true for the bootstrap email even with no admin group - never locks every admin out", () => {
    expect(isEffectiveAdmin(ADMIN, ADMIN, [])).toBe(true);
    expect(isEffectiveAdmin(ADMIN, ADMIN, undefined)).toBe(true);
  });
  it("false for neither", () => {
    expect(isEffectiveAdmin("other@example.com", ADMIN, ["other-group"])).toBe(false);
  });
});

describe("checkInviteEmail", () => {
  it("accepts a plausible, unclaimed address", () => {
    expect(checkInviteEmail("new@example.com", ["someone@example.com"])).toBeNull();
  });
  it("refuses something that isn't an email shape", () => {
    expect(checkInviteEmail("not-an-email", [])).toMatch(/real email/);
    expect(checkInviteEmail("  ", [])).toMatch(/real email/);
  });
  it("refuses an email already claimed, case-insensitively", () => {
    expect(checkInviteEmail("Someone@Example.com", ["someone@example.com"])).toMatch(/already a Tally account/);
  });
});
