import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubTempSystemDir } from "./helpers/system-dir";
import { MIN_PASSWORD_LENGTH, checkNewPassword, isLockEnabled, lockFilePath, removeLock, setLockPassword, verifyLockPassword } from "@/lib/desktop/lock";
import { sessionCookieValue } from "@/lib/desktop/gate";

// Server actions run inside a request; here that is a fake cookie jar, and
// redirect() throws like the real one does.
const jar = vi.hoisted(() => ({ set: [] as { name: string; value: string; opts: Record<string, unknown> }[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string, opts: Record<string, unknown>) => jar.set.push({ name, value, opts }), get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/session", () => ({ requireSession: (fn: (u: unknown) => unknown) => fn({ id: 1, isAdmin: true }) }));

let dir: string;
beforeEach(() => {
  dir = stubTempSystemDir("tally-lock-");
  vi.stubEnv("TALLY_MODE", "desktop");
  vi.stubEnv("LAUNCH_TOKEN", "launch-token");
  jar.set.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("app lock file", () => {
  it("is off until a password is set, and lives beside the databases", () => {
    expect(isLockEnabled()).toBe(false);
    setLockPassword("correct horse");
    expect(isLockEnabled()).toBe(true);
    expect(lockFilePath()).toBe(path.join(dir, "app-lock.json"));
  });
  it("accepts the right password and refuses a wrong one", () => {
    setLockPassword("correct horse");
    expect(verifyLockPassword("correct horse")).toBe(true);
    expect(verifyLockPassword("correct hors")).toBe(false);
    expect(verifyLockPassword("")).toBe(false);
  });
  it("never stores the password, and the file is private to the user", () => {
    setLockPassword("correct horse");
    const raw = fs.readFileSync(lockFilePath(), "utf8");
    expect(raw).not.toContain("correct horse");
    expect(fs.statSync(lockFilePath()).mode & 0o077).toBe(0);
  });
  it("salts every password: the same one hashes differently twice", () => {
    setLockPassword("correct horse");
    const first = fs.readFileSync(lockFilePath(), "utf8");
    setLockPassword("correct horse");
    expect(fs.readFileSync(lockFilePath(), "utf8")).not.toBe(first);
    expect(verifyLockPassword("correct horse")).toBe(true);
  });
  it("changing the password retires the old one", () => {
    setLockPassword("first password");
    setLockPassword("second password");
    expect(verifyLockPassword("first password")).toBe(false);
    expect(verifyLockPassword("second password")).toBe(true);
  });
  it("rejects a too-short or absurdly long new password, leaving any existing lock alone", () => {
    expect(checkNewPassword("x".repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
    expect(checkNewPassword("x".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(checkNewPassword("x".repeat(201))).not.toBeNull();
    setLockPassword("correct horse");
    expect(() => setLockPassword("short")).toThrow("at least");
    expect(verifyLockPassword("correct horse")).toBe(true);
  });
  it("a damaged lock file keeps the app LOCKED - it never opens it", () => {
    fs.writeFileSync(lockFilePath(), "{not json");
    expect(isLockEnabled()).toBe(true);
    expect(verifyLockPassword("anything at all")).toBe(false);
    fs.writeFileSync(lockFilePath(), JSON.stringify({ v: 2 }));
    expect(verifyLockPassword("anything at all")).toBe(false);
  });
  it("removing the lock turns it off, and is harmless when there isn't one", () => {
    removeLock();
    setLockPassword("correct horse");
    removeLock();
    expect(isLockEnabled()).toBe(false);
  });
});

describe("unlockAction", () => {
  const form = (password: string) => {
    const f = new FormData();
    f.set("password", password);
    return f;
  };
  const unlock = async (password: string) => (await import("@/app/unlock/actions")).unlockAction({ error: null }, form(password));

  it("a wrong password gets an error and NO cookie", async () => {
    setLockPassword("correct horse");
    expect(await unlock("wrong")).toEqual({ error: "Wrong password." });
    expect(jar.set).toHaveLength(0);
  });
  it("the right password sets the full session cookie and goes to the grid", async () => {
    setLockPassword("correct horse");
    await expect(unlock("correct horse")).rejects.toThrow("REDIRECT:/grid");
    expect(jar.set).toHaveLength(1);
    expect(jar.set[0]).toMatchObject({ name: "tally_desktop", value: await sessionCookieValue("launch-token") });
    expect(jar.set[0].opts).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
  });
  it("throttles guessing: after 5 tries even the right password is refused for the window", async () => {
    setLockPassword("correct horse");
    for (let i = 0; i < 5; i++) await unlock("wrong");
    expect(await unlock("correct horse")).toEqual({ error: expect.stringContaining("Too many") });
    expect(jar.set).toHaveLength(0);
  });
  it("with no lock set there's nothing to unlock", async () => {
    await expect(unlock("anything")).rejects.toThrow("REDIRECT:/grid");
    expect(jar.set).toHaveLength(0);
  });
  it("doesn't exist outside desktop mode", async () => {
    setLockPassword("correct horse");
    vi.stubEnv("TALLY_MODE", "web");
    await expect(unlock("correct horse")).rejects.toThrow("REDIRECT:/grid");
    expect(jar.set).toHaveLength(0);
  });
});

describe("settings actions", () => {
  const actions = () => import("@/app/settings/app-lock-actions");

  it("sets a first password without needing a current one", async () => {
    const { setAppLockAction } = await actions();
    expect(await setAppLockAction("correct horse", "")).toEqual({ ok: true });
    expect(verifyLockPassword("correct horse")).toBe(true);
  });
  it("won't change an existing password without the current one", async () => {
    const { setAppLockAction } = await actions();
    setLockPassword("correct horse");
    expect(await setAppLockAction("brand new one", "wrong")).toEqual({ ok: false, error: "The current password is wrong." });
    expect(verifyLockPassword("correct horse")).toBe(true);
    expect(await setAppLockAction("brand new one", "correct horse")).toEqual({ ok: true });
    expect(verifyLockPassword("brand new one")).toBe(true);
  });
  it("won't turn the lock off without the current password", async () => {
    const { removeAppLockAction } = await actions();
    setLockPassword("correct horse");
    expect((await removeAppLockAction("wrong")).ok).toBe(false);
    expect(isLockEnabled()).toBe(true);
    expect(await removeAppLockAction("correct horse")).toEqual({ ok: true });
    expect(isLockEnabled()).toBe(false);
  });
  it("reports a too-short new password as a message, not a crash", async () => {
    const { setAppLockAction } = await actions();
    expect(await setAppLockAction("short", "")).toMatchObject({ ok: false, error: expect.stringContaining("at least") });
    expect(isLockEnabled()).toBe(false);
  });
  it("refuses everything outside desktop mode", async () => {
    const { setAppLockAction } = await actions();
    vi.stubEnv("TALLY_MODE", "web");
    expect(await setAppLockAction("correct horse", "")).toMatchObject({ ok: false });
    expect(isLockEnabled()).toBe(false);
  });
});

describe("/api/desktop/lock (Lock now)", () => {
  const lock = async () => (await import("@/app/api/desktop/lock/route")).GET();

  it("swaps in the locked cookie and goes to the unlock screen", async () => {
    setLockPassword("correct horse");
    const res = await lock();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/unlock");
    expect(res.headers.get("set-cookie")).toContain(`tally_desktop=${await sessionCookieValue("launch-token", "locked")}`);
  });
  it("404s when no lock is set - nothing to lock - and outside desktop mode", async () => {
    expect((await lock()).status).toBe(404);
    setLockPassword("correct horse");
    vi.stubEnv("TALLY_MODE", "web");
    expect((await lock()).status).toBe(404);
  });
});
