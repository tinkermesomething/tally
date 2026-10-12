import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mutable-mock pattern as tests/household.test.ts, for the same
// reason: the real @/auth pulls in next-auth, which fails to resolve
// "next/server" under vitest - and this file needs to flip between
// signed-out, signed-in-as-a-real-user, and signed-in-as-a-sub-that-
// doesn't-resolve, which a single fixed mock can't do.
const authState = vi.hoisted(() => ({ signedIn: true, sub: "test-sub" }));
vi.mock("@/auth", () => ({
  auth: async () => (authState.signedIn ? { user: { email: "t@t", sub: authState.sub } } : null),
}));

import { resetDb } from "./helpers/db";
import { seedSignedInUser } from "./helpers/user";
import { updateAppSettings } from "@/lib/db/settings";
import { resolveLocale } from "@/lib/locale";
import { runWithUserDb } from "@/lib/db/context";
import { resolveCurrentUser } from "@/lib/db/current-user";
import { DEFAULT_LOCALE } from "@/lib/locales";

beforeEach(() => {
  resetDb();
  authState.signedIn = true;
  authState.sub = "test-sub";
});

describe("resolveLocale", () => {
  it("falls back to the default with no session at all", async () => {
    authState.signedIn = false;
    expect(await resolveLocale()).toBe(DEFAULT_LOCALE);
  });

  it("falls back to the default when the session's sub resolves to no account", async () => {
    authState.sub = "nobody-sub";
    expect(await resolveLocale()).toBe(DEFAULT_LOCALE);
  });

  it("reads the signed-in user's own saved locale", async () => {
    await seedSignedInUser("test-sub", "t@t");
    const { conn } = await resolveCurrentUser();
    await runWithUserDb(conn, () => updateAppSettings({ locale: "fr" }));
    expect(await resolveLocale()).toBe("fr");
  });

  it("defaults to english for a freshly created account that never set one", async () => {
    await seedSignedInUser("test-sub", "t@t");
    expect(await resolveLocale()).toBe(DEFAULT_LOCALE);
  });
});
