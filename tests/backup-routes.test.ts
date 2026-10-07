import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { decryptBackup, isEncryptedBackup } from "@/lib/backup-crypto";

const session = vi.hoisted(() => ({ value: { user: { email: "t@t" } } as unknown }));
vi.mock("@/auth", () => ({ auth: async () => session.value }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));

import { POST as download } from "@/app/settings/backup/route";
import { POST as restore } from "@/app/settings/restore/route";

const form = (fields: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const post = (route: (r: Request) => Promise<Response>, fields: Record<string, string | Blob>) =>
  route(new Request("http://localhost/x", { method: "POST", body: form(fields) }));
const names = async () => (await db.select().from(categories)).map((c) => c.name).sort();

beforeEach(() => {
  resetDb();
  session.value = { user: { email: "t@t" } };
});

describe("download", () => {
  it("needs a session", async () => {
    session.value = null;
    expect((await post(download, { password: "longenough" })).status).toBe(401);
  });

  it("is password-protected by default: leaving the password out is refused, not downgraded to a plain file", async () => {
    const res = await post(download, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 8/);
    expect((await post(download, { password: "short" })).status).toBe(400);
  });

  it("returns an encrypted .tallybak that only the password opens", async () => {
    await db.insert(categories).values({ name: "Rent" });
    const res = await post(download, { password: "longenough" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/\.tallybak"/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(isEncryptedBackup(body)).toBe(true);
    expect(body.includes(Buffer.from("Rent"))).toBe(false);
    expect(decryptBackup(body, "longenough").subarray(0, 15).toString()).toBe("SQLite format 3");
  });

  it("gives a plain .db only when explicitly asked", async () => {
    const res = await post(download, { unprotected: "1" });
    expect(res.headers.get("Content-Disposition")).toMatch(/\.db"/);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 15).toString()).toBe("SQLite format 3");
  });

  it("does not answer a GET (the password must never be in a URL)", async () => {
    const mod = await import("@/app/settings/backup/route");
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe("restore", () => {
  async function backupOf(password?: string) {
    const res = await post(download, password ? { password } : { unprotected: "1" });
    return new Blob([new Uint8Array(await res.arrayBuffer())]);
  }

  it("restores a protected file with the right password", async () => {
    await db.insert(categories).values({ name: "Original" });
    const file = await backupOf("longenough");
    await db.insert(categories).values({ name: "Added later" });
    const res = await post(restore, { file, password: "longenough" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(await names()).toEqual(["Original"]);
  });

  it("a wrong or missing password changes nothing", async () => {
    await db.insert(categories).values({ name: "Original" });
    const file = await backupOf("longenough");
    await db.insert(categories).values({ name: "Added later" });
    const wrong = await post(restore, { file, password: "not the one" });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toMatch(/Wrong password/);
    const missing = await post(restore, { file });
    expect((await missing.json()).error).toMatch(/Enter its password/);
    expect(await names()).toEqual(["Added later", "Original"]);
  });

  it("a plain file is refused unless the caller says it has no password", async () => {
    await db.insert(categories).values({ name: "Original" });
    const file = await backupOf();
    await db.insert(categories).values({ name: "Added later" });
    const refused = await post(restore, { file });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/no password protection/);
    expect(await names()).toEqual(["Added later", "Original"]);
    const ok = await post(restore, { file, allowUnprotected: "1" });
    expect((await ok.json()).ok).toBe(true);
    expect(await names()).toEqual(["Original"]);
  });

  it("needs a session and a file", async () => {
    expect((await post(restore, {})).status).toBe(400);
    session.value = null;
    expect((await post(restore, { file: new Blob(["x"]) })).status).toBe(401);
  });

  it("junk behind a password is not restored", async () => {
    const { encryptBackup } = await import("@/lib/backup-crypto");
    const junk = new Blob([new Uint8Array(encryptBackup(Buffer.from("not a database"), "longenough"))]);
    const res = await post(restore, { file: junk, password: "longenough" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't a Tally backup/);
  });
});
