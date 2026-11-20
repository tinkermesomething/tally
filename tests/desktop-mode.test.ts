import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/db";
import { DESKTOP_EMAIL, DESKTOP_SUB, isDesktopMode } from "@/lib/desktop/mode";
import { ensureDesktopUser, getUserBySub, listUsers } from "@/lib/db/users";
import { dekToHex, openDek } from "@/lib/user-dek";
import { sessionCookieValue } from "@/lib/desktop/gate";
import { closeAndForget, getOrOpenUserDb } from "@/lib/db/pool";
import { categories } from "@/lib/db/schema";
import { isHouseholdEnabled, setHouseholdEnabled } from "@/lib/db/household";

// The desktop session is only handed to a request carrying the full session
// cookie, so auth() reads the request's cookies - faked here.
const jar = vi.hoisted(() => ({ value: undefined as string | undefined, throws: false }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (jar.throws) throw new Error("cookies() called outside a request scope");
    return { get: (name: string) => (name === "tally_desktop" && jar.value ? { name, value: jar.value } : undefined) };
  },
}));

// next-auth can't be loaded under vitest (its ESM import of next/server
// fails to resolve) and isn't what is under test - only which `auth` auth.ts exports.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: async () => "real-authjs", signIn: vi.fn(), signOut: vi.fn() }),
}));

beforeEach(() => resetDb());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("isDesktopMode", () => {
  it("is off unless TALLY_MODE is exactly 'desktop'", () => {
    expect(isDesktopMode()).toBe(false);
    vi.stubEnv("TALLY_MODE", "web");
    expect(isDesktopMode()).toBe(false);
    vi.stubEnv("TALLY_MODE", "desktop");
    expect(isDesktopMode()).toBe(true);
  });
});

describe("auth config in desktop mode", () => {
  it("has no providers and lets every request through", async () => {
    vi.stubEnv("TALLY_MODE", "desktop");
    const { default: authConfig } = await import("@/auth.config");
    const config = authConfig();
    expect(config.providers).toEqual([]);
    expect(config.callbacks?.authorized?.({ request: { nextUrl: { pathname: "/grid" } }, auth: null } as never)).toBe(true);
  });

  it("is still the OIDC config for the web build", async () => {
    const { default: authConfig } = await import("@/auth.config");
    expect(authConfig().providers).toHaveLength(1);
  });
});

describe("auth() in desktop mode", () => {
  const session = async () => {
    const { auth } = await import("@/auth");
    return (auth as unknown as () => Promise<{ user: { sub: string; email: string }; expires: string } | null>)();
  };
  beforeEach(() => {
    vi.stubEnv("TALLY_MODE", "desktop");
    vi.stubEnv("LAUNCH_TOKEN", "launch-token");
    jar.value = undefined;
    jar.throws = false;
  });

  it("returns the one local user to a window with the full session cookie", async () => {
    jar.value = await sessionCookieValue("launch-token");
    const result = await session();
    expect(result?.user).toMatchObject({ sub: DESKTOP_SUB, email: DESKTOP_EMAIL });
    expect(new Date(result!.expires).getTime()).toBeGreaterThan(Date.now());
  });
  it("signs a still-locked window out, so the unlock screen renders no account data", async () => {
    jar.value = await sessionCookieValue("launch-token", "locked");
    expect(await session()).toBeNull();
  });
  it("signs out a request with no cookie, a wrong one, another launch's, or no request at all", async () => {
    expect(await session()).toBeNull();
    jar.value = "nope";
    expect(await session()).toBeNull();
    jar.value = await sessionCookieValue("last-launch");
    expect(await session()).toBeNull();
    jar.value = await sessionCookieValue("launch-token");
    jar.throws = true;
    expect(await session()).toBeNull();
  });
  it("signs everyone out when the launch token is missing", async () => {
    jar.value = await sessionCookieValue("launch-token");
    vi.stubEnv("LAUNCH_TOKEN", "");
    expect(await session()).toBeNull();
  });
});

describe("auth() in web mode", () => {
  it("is still Auth.js's own", async () => {
    const { auth } = await import("@/auth");
    expect(await (auth as unknown as () => Promise<string>)()).toBe("real-authjs");
  });
});

describe("ensureDesktopUser", () => {
  it("creates one admin account whose key opens under the desktop identity", async () => {
    const user = await ensureDesktopUser();
    expect(user).toMatchObject({ oidcSub: DESKTOP_SUB, email: DESKTOP_EMAIL, isAdmin: true });
    expect(openDek(user.dekSealed!, DESKTOP_SUB)).toHaveLength(32);
  });

  it("is idempotent - a second call never re-seals the key (that would orphan the encrypted database)", async () => {
    const first = await ensureDesktopUser();
    const second = await ensureDesktopUser();
    expect(second.id).toBe(first.id);
    expect(second.dekSealed).toBe(first.dekSealed);
    expect(await listUsers()).toHaveLength(1);
    expect((await getUserBySub(DESKTOP_SUB))?.dekSealed).toBe(first.dekSealed);
  });
  it("data written with the desktop key is still readable after a close and reopen (what an app restart does)", async () => {
    const user = await ensureDesktopUser();
    const key = dekToHex(openDek(user.dekSealed!, DESKTOP_SUB));
    const first = getOrOpenUserDb(user.id, key);
    await first.db.insert(categories).values({ name: "Survives restart" });
    closeAndForget(user.id);

    const reread = await ensureDesktopUser();
    const second = getOrOpenUserDb(reread.id, dekToHex(openDek(reread.dekSealed!, DESKTOP_SUB)));
    expect((await second.db.select().from(categories)).map((c) => c.name)).toEqual(["Survives restart"]);
    closeAndForget(user.id);
  });

  it("a different AUTH_SECRET can't open the key - it fails loudly rather than starting an empty database", async () => {
    const user = await ensureDesktopUser();
    vi.stubEnv("AUTH_SECRET", "some-other-secret");
    expect(() => openDek(user.dekSealed!, DESKTOP_SUB)).toThrow("can't be opened");
  });
});

describe("household in desktop mode", () => {
  it("stays off even if the flag is on in the keystore", async () => {
    await setHouseholdEnabled(true);
    expect(await isHouseholdEnabled()).toBe(true);
    vi.stubEnv("TALLY_MODE", "desktop");
    expect(await isHouseholdEnabled()).toBe(false);
  });
});

describe("bank sync in desktop mode", () => {
  it("refuses every GoCardless call at the one place they all go through", async () => {
    vi.stubEnv("TALLY_MODE", "desktop");
    const { listInstitutions } = await import("@/lib/gocardless");
    await expect(listInstitutions("GB")).rejects.toThrow("desktop app");
  });
});
