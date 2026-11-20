import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENTER_PATH, gateDecision, isAllowedHost, safeEqual, sessionCookieValue } from "@/lib/desktop/gate";

const TOKEN = "t".repeat(64);
const PORT = "4455";
const HOST = `127.0.0.1:${PORT}`;
const base = { host: HOST, pathname: "/grid", cookie: undefined, token: TOKEN, port: PORT };

describe("sessionCookieValue", () => {
  it("is deterministic, hex, and never the token itself", async () => {
    const a = await sessionCookieValue(TOKEN);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await sessionCookieValue(TOKEN));
    expect(a).not.toContain(TOKEN);
  });
  it("differs for every launch token", async () => {
    expect(await sessionCookieValue("a")).not.toBe(await sessionCookieValue("b"));
  });
});

describe("safeEqual", () => {
  it("compares whole strings, including different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });
});

describe("isAllowedHost", () => {
  it("accepts only 127.0.0.1 on this server's own port", () => {
    expect(isAllowedHost(HOST, PORT)).toBe(true);
    for (const h of ["localhost:4455", "127.0.0.1", "127.0.0.1:4456", "evil.com", "evil.com:4455", "127.0.0.1:4455.evil.com", null]) {
      expect(isAllowedHost(h, PORT)).toBe(false);
    }
  });
  it("accepts nothing when the port isn't configured", () => {
    expect(isAllowedHost("127.0.0.1:undefined", undefined)).toBe(false);
  });
});

describe("gateDecision", () => {
  it("lets the window in with the right cookie", async () => {
    expect(await gateDecision({ ...base, cookie: await sessionCookieValue(TOKEN) })).toBe("allow");
  });
  it("refuses a page, an API route, a backup download and an action without the cookie", async () => {
    for (const pathname of ["/grid", "/api/v1/grid", "/settings/backup", "/settings/restore", "/settings/avatar/1"]) {
      expect(await gateDecision({ ...base, pathname })).toBe("deny");
    }
  });
  it("refuses a wrong cookie, including the raw token", async () => {
    expect(await gateDecision({ ...base, cookie: "nope" })).toBe("deny");
    expect(await gateDecision({ ...base, cookie: TOKEN })).toBe("deny");
  });
  it("refuses a cookie minted from another launch's token", async () => {
    expect(await gateDecision({ ...base, cookie: await sessionCookieValue("last-launch") })).toBe("deny");
  });
  it("refuses a rebound hostname even WITH a valid cookie", async () => {
    expect(await gateDecision({ ...base, host: `evil.com:${PORT}`, cookie: await sessionCookieValue(TOKEN) })).toBe("deny");
  });
  it("lets health and the token swap through without a cookie - but only on the right host", async () => {
    expect(await gateDecision({ ...base, pathname: "/api/health" })).toBe("allow");
    expect(await gateDecision({ ...base, pathname: ENTER_PATH })).toBe("allow");
    expect(await gateDecision({ ...base, pathname: "/api/health", host: "evil.com" })).toBe("deny");
  });
  it("lets a LOCKED window reach only the unlock screen and its assets", async () => {
    const cookie = await sessionCookieValue(TOKEN, "locked");
    for (const pathname of ["/unlock", "/_next/static/chunks/app.js", "/favicon.ico", "/icon.svg"]) {
      expect(await gateDecision({ ...base, pathname, cookie })).toBe("allow");
    }
    for (const pathname of ["/grid", "/settings", "/settings/backup", "/settings/restore", "/api/v1/grid", "/unlock/extra", "/api/auth/session"]) {
      expect(await gateDecision({ ...base, pathname, cookie })).toBe("deny");
    }
  });
  it("a locked cookie is not the session cookie, and still needs the right host", async () => {
    expect(await sessionCookieValue(TOKEN, "locked")).not.toBe(await sessionCookieValue(TOKEN));
    expect(await gateDecision({ ...base, pathname: "/unlock", host: "evil.com", cookie: await sessionCookieValue(TOKEN, "locked") })).toBe("deny");
  });
  it("fails closed when the token or port is missing", async () => {
    const cookie = await sessionCookieValue(TOKEN);
    expect(await gateDecision({ ...base, cookie, token: undefined })).toBe("deny");
    expect(await gateDecision({ ...base, cookie, port: undefined })).toBe("deny");
    expect(await gateDecision({ ...base, pathname: "/api/health", token: undefined })).toBe("deny");
  });
});

describe("/api/desktop/enter", () => {
  afterEach(() => vi.unstubAllEnvs());
  const call = async (query: string) => (await import("@/app/api/desktop/enter/route")).GET(new Request(`http://127.0.0.1:${PORT}${ENTER_PATH}${query}`));

  it("swaps the right token for the session cookie and goes to the grid", async () => {
    vi.stubEnv("TALLY_MODE", "desktop");
    vi.stubEnv("LAUNCH_TOKEN", TOKEN);
    const res = await call(`?t=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/grid");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`tally_desktop=${await sessionCookieValue(TOKEN)}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
  });
  it("404s a wrong or missing token, with no cookie", async () => {
    vi.stubEnv("TALLY_MODE", "desktop");
    vi.stubEnv("LAUNCH_TOKEN", TOKEN);
    for (const q of ["", "?t=", "?t=wrong", `?t=${TOKEN}x`]) {
      const res = await call(q);
      expect(res.status).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
  it("starts the window LOCKED, at the unlock screen, when an app lock is set", async () => {
    vi.stubEnv("TALLY_MODE", "desktop");
    vi.stubEnv("LAUNCH_TOKEN", TOKEN);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-enter-"));
    vi.stubEnv("SYSTEM_DB_PATH", path.join(dir, "system.db"));
    const { setLockPassword } = await import("@/lib/desktop/lock");
    setLockPassword("correct horse");
    const res = await call(`?t=${TOKEN}`);
    expect(res.headers.get("location")).toBe("/unlock");
    expect(res.headers.get("set-cookie")).toContain(`tally_desktop=${await sessionCookieValue(TOKEN, "locked")}`);
  });
  it("doesn't exist outside desktop mode", async () => {
    vi.stubEnv("LAUNCH_TOKEN", TOKEN);
    expect((await call(`?t=${TOKEN}`)).status).toBe(404);
  });

  it("a locked window cannot slip out of /_next/static/ or sideways to other /_next/ paths", async () => {
    for (const pathname of ["/_next/image", "/_next/data/x.json", "/_next/../grid", "/unlock/", "/UNLOCK"]) {
      expect(await gateDecision({ ...base, pathname, cookie: await sessionCookieValue(TOKEN, "locked") }), pathname).toBe("deny");
    }
  });
});
