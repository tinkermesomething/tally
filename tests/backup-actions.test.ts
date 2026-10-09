import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "t@t", sub: "test-sub" } }) }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));
const fwdFor = vi.hoisted(() => ({ value: "7.7.7.7" }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k === "x-forwarded-for" ? fwdFor.value : null) }),
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetDb } from "./helpers/db";
import { asSignedInUser } from "./helpers/user";
import { auditLog } from "@/lib/db/schema";
import { resetAutoBackupSettings, saveAutoBackupSettings } from "@/app/settings/backup-actions";
import { getAutoBackupStored } from "@/lib/db/settings";
import { getSystemConn } from "@/lib/db/system-connection";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tally-ba-"));

beforeEach(() => {
  resetDb();
  fwdFor.value = "7.7.7.7";
  process.env.AUTH_SECRET = "test-secret";
});

describe("saveAutoBackupSettings", () => {
  it(
    "saves and records the change, with the client IP, never the password",
    asSignedInUser("test-sub", "t@t", async () => {
      const res = await saveAutoBackupSettings({ dir: dir(), frequencyHours: 24, hour: 3, weekday: 1, keep: 5, protect: true, password: "longenough" });
      expect(res.ok).toBe(true);
      expect(await getAutoBackupStored()).not.toBeNull();
      const row = (await getSystemConn().db.select().from(auditLog))[0];
      expect(row).toMatchObject({ action: "auto_backup_settings_changed", ip: "7.7.7.7" });
      expect(row.detail).not.toContain("longenough");
      expect(row.detail).toMatch(/freq=24h/);
    })
  );

  it(
    "a bad folder is refused and nothing is logged as changed",
    asSignedInUser("test-sub", "t@t", async () => {
      const res = await saveAutoBackupSettings({ dir: "relative", frequencyHours: 24, hour: 3, weekday: 1, keep: 5, protect: false });
      expect(res.ok).toBe(false);
      expect(await getSystemConn().db.select().from(auditLog)).toHaveLength(0);
    })
  );
});

describe("resetAutoBackupSettings", () => {
  it(
    "clears the saved settings and records it",
    asSignedInUser("test-sub", "t@t", async () => {
      await saveAutoBackupSettings({ dir: dir(), frequencyHours: 24, hour: 3, weekday: 1, keep: 5, protect: false });
      const res = await resetAutoBackupSettings();
      expect(res.ok).toBe(true);
      expect(await getAutoBackupStored()).toBeNull();
      expect((await getSystemConn().db.select().from(auditLog)).map((r) => r.action)).toEqual(["auto_backup_settings_changed", "auto_backup_settings_reset"]);
    })
  );
});
