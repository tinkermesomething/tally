import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { decryptBackup, openSecret, sealSecret } from "@/lib/backup-crypto";
import { getAutoBackupStored, setAutoBackupStored, updateAppSettings } from "@/lib/db/settings";
import { autoBackupStatus, isAutoBackupDue, listAutoBackups, maybeRunAutoBackup, resolveAutoBackupConfig, runAutoBackup, runAutoBackupNow } from "@/lib/auto-backup";
import { describeSchedule, parseStored, scheduleState, validateSettingsInput, type BackupSettingsInput } from "@/lib/auto-backup-settings";

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "tally-ab-"));
const LON = "Europe/London";
const at = (iso: string) => new Date(iso).getTime();
const sched = (frequencyHours: number, hour = 3, weekday = 1) => ({ frequencyHours, hour, weekday });
const cfg = (dir: string, over: Record<string, unknown> = {}) => ({ dir, password: null, frequencyHours: 24, hour: 3, weekday: 1, keep: 14, ...over });

process.env.AUTH_SECRET = "test-secret-for-sealing";
beforeEach(() => resetDb());

describe("which settings apply", () => {
  it("nothing is set up without a folder", () => {
    expect(resolveAutoBackupConfig({}, {}).config).toBeNull();
    expect(resolveAutoBackupConfig({}, { BACKUP_DIR: "  " }).config).toBeNull();
  });

  it("the .env supplies the starting values, defaults fill the rest", () => {
    const r = resolveAutoBackupConfig({}, { BACKUP_DIR: "/x", BACKUP_PASSWORD: "longenough", BACKUP_HOUR: "6", BACKUP_KEEP: "3" });
    expect(r.config).toMatchObject({ dir: "/x", password: "longenough", hour: 6, keep: 3, frequencyHours: 24, weekday: 1 });
    expect(r.problem).toBeNull();
    expect(resolveAutoBackupConfig({}, { BACKUP_DIR: "/x", BACKUP_PASSWORD: "p", BACKUP_HOUR: "99", BACKUP_KEEP: "0" }).config).toMatchObject({ hour: 3, keep: 14 });
  });

  it("what was saved in Settings wins over the .env", () => {
    const r = resolveAutoBackupConfig(
      { dir: "/saved", hour: 5, keep: 30, frequencyHours: 168, weekday: 6, protect: true, passwordSealed: sealSecret("my saved pass") },
      { BACKUP_DIR: "/env", BACKUP_PASSWORD: "envpassword", BACKUP_HOUR: "1" }
    );
    expect(r.config).toMatchObject({ dir: path.resolve("/saved"), hour: 5, keep: 30, frequencyHours: 168, weekday: 6, password: "my saved pass" });
    expect(r.source).toEqual({ dir: "saved", password: "saved" });
  });

  it("is protected by default: no password anywhere means a problem, not a plain backup", () => {
    const r = resolveAutoBackupConfig({ dir: "/x" }, {});
    expect(r.config).not.toBeNull();
    expect(r.problem).toMatch(/Set a password/);
  });

  it("plain backups only when protection was deliberately turned off", () => {
    const r = resolveAutoBackupConfig({ dir: "/x", protect: false }, { BACKUP_PASSWORD: "envpassword" });
    expect(r.config!.password).toBeNull();
    expect(r.problem).toBeNull();
    expect(r.source.password).toBe("off");
  });

  it("a short .env password or an unreadable sealed password is reported, never used", () => {
    expect(resolveAutoBackupConfig({}, { BACKUP_DIR: "/x", BACKUP_PASSWORD: "short" }).problem).toMatch(/at least 8/);
    expect(resolveAutoBackupConfig({ dir: "/x", protect: true, passwordSealed: "v1.garbage" }, {}).problem).toMatch(/Enter it again/);
  });
});

describe("saved settings are checked", () => {
  const good: BackupSettingsInput = { dir: "/app/backups", frequencyHours: 24, hour: 3, weekday: 1, keep: 14, protect: true, password: "longenough" };
  const run = (over: Partial<BackupSettingsInput>, existing = {}, envHasPassword = false) => validateSettingsInput({ ...good, ...over }, existing, { seal: sealSecret, envHasPassword });

  it("accepts a good form and seals the password", () => {
    const out = run({});
    expect(out).toMatchObject({ dir: "/app/backups", frequencyHours: 24, hour: 3, keep: 14, protect: true });
    expect(out.passwordSealed).toMatch(/^v1\./);
    expect(JSON.stringify(out)).not.toContain("longenough");
    expect(openSecret(out.passwordSealed!)).toBe("longenough");
  });

  it("explains each bad value", () => {
    expect(() => run({ dir: " " })).toThrow("Enter the folder");
    expect(() => run({ dir: "relative/path" })).toThrow("full path");
    expect(() => run({ dir: "/" })).toThrow("not the top of the disk");
    expect(() => run({ frequencyHours: 5 })).toThrow("how often");
    expect(() => run({ hour: 24 })).toThrow("hour");
    expect(() => run({ weekday: 7 })).toThrow("day of the week");
    expect(() => run({ keep: 0 })).toThrow("between 1 and 365");
    expect(() => run({ keep: 366 })).toThrow("between 1 and 365");
    expect(() => run({ password: "short" })).toThrow("at least 8");
  });

  it("protection needs a password from somewhere", () => {
    expect(() => run({ password: "" })).toThrow("Enter a password");
    expect(run({ password: "" }, { protect: true, passwordSealed: "v1.keepme" }).passwordSealed).toBe("v1.keepme"); // empty = keep the saved one
    expect(run({ password: "" }, {}, true).protect).toBeUndefined(); // keeps following the .env password
  });

  it("turning protection off drops the stored password", () => {
    const out = run({ protect: false, password: "" }, { protect: true, passwordSealed: "v1.x" });
    expect(out).toMatchObject({ protect: false });
    expect(out.passwordSealed).toBeUndefined();
  });

  it("damaged saved JSON is ignored field by field", () => {
    expect(parseStored("not json")).toEqual({});
    expect(parseStored(JSON.stringify({ dir: "/x", hour: 99, keep: "7", frequencyHours: 5, weekday: 3 }))).toEqual({ dir: "/x", weekday: 3 });
    expect(parseStored(null)).toEqual({});
  });

  it("describes the schedule in words", () => {
    expect(describeSchedule(sched(24), LON)).toBe("Every day at 03:00 (Europe/London)");
    expect(describeSchedule(sched(168, 4, 1), LON)).toBe("Every week on Monday at 04:00 (Europe/London)");
    expect(describeSchedule(sched(6), LON)).toBe("Every 6 hours from 03:00 (Europe/London)");
    expect(describeSchedule(sched(48), LON)).toBe("Every 2 days at 03:00 (Europe/London)");
  });
});

describe("when a backup is due", () => {
  it("daily: due until today's 03:00 has a backup", () => {
    const now = at("2026-12-10T12:00:00Z");
    expect(scheduleState(null, sched(24), now, LON)).toMatchObject({ due: true, nextAt: now });
    expect(scheduleState(at("2026-12-09T03:00:00Z"), sched(24), now, LON).due).toBe(true);
    const s = scheduleState(at("2026-12-10T03:10:00Z"), sched(24), now, LON);
    expect(s.due).toBe(false);
    expect(new Date(s.nextAt).toISOString()).toBe("2026-12-11T03:00:00.000Z");
    expect(scheduleState(at("2026-12-09T03:10:00Z"), sched(24), at("2026-12-10T02:00:00Z"), LON).due).toBe(false); // before 03:00, yesterday's counts
  });

  it("every 6 and 12 hours follow the clock", () => {
    // 6h from 03:00 -> 03,09,15,21
    expect(scheduleState(at("2026-12-10T09:05:00Z"), sched(6), at("2026-12-10T14:00:00Z"), LON).due).toBe(false);
    expect(scheduleState(at("2026-12-10T09:05:00Z"), sched(6), at("2026-12-10T15:30:00Z"), LON).due).toBe(true);
    expect(new Date(scheduleState(at("2026-12-10T09:05:00Z"), sched(6), at("2026-12-10T14:00:00Z"), LON).nextAt).toISOString()).toBe("2026-12-10T15:00:00.000Z");
    // 12h from 03:00 -> 03,15
    expect(scheduleState(at("2026-12-10T03:05:00Z"), sched(12), at("2026-12-10T14:00:00Z"), LON).due).toBe(false);
    expect(scheduleState(at("2026-12-10T03:05:00Z"), sched(12), at("2026-12-10T15:01:00Z"), LON).due).toBe(true);
  });

  it("every 2 days waits two days, and a missed one is taken as soon as the app is back", () => {
    const wrote = at("2026-12-10T03:05:00Z");
    expect(scheduleState(wrote, sched(48), at("2026-12-11T12:00:00Z"), LON).due).toBe(false);
    const day2 = scheduleState(wrote, sched(48), at("2026-12-11T12:00:00Z"), LON);
    expect(new Date(day2.nextAt).toISOString()).toBe("2026-12-12T03:00:00.000Z");
    expect(scheduleState(wrote, sched(48), at("2026-12-12T03:30:00Z"), LON).due).toBe(true);
    expect(scheduleState(wrote, sched(48), at("2026-12-20T09:00:00Z"), LON).due).toBe(true); // app was off
  });

  it("every 2 days is not thrown off by the clocks going back", () => {
    // BST ends 2026-10-25. Backed up on the 24th at 03:00 BST (02:00Z); the 25th must NOT be due, the 26th is.
    const wrote = at("2026-10-24T02:05:00Z");
    expect(scheduleState(wrote, sched(48), at("2026-10-25T12:00:00Z"), LON).due).toBe(false);
    expect(scheduleState(wrote, sched(48), at("2026-10-26T12:00:00Z"), LON).due).toBe(true);
  });

  it("weekly: only on the chosen weekday at the chosen hour", () => {
    // 2026-12-14 is a Monday
    const monday = sched(168, 3, 1);
    const lastMon = at("2026-12-07T03:05:00Z");
    expect(scheduleState(lastMon, monday, at("2026-12-10T12:00:00Z"), LON).due).toBe(false); // Thursday
    expect(new Date(scheduleState(lastMon, monday, at("2026-12-10T12:00:00Z"), LON).nextAt).toISOString()).toBe("2026-12-14T03:00:00.000Z");
    expect(scheduleState(lastMon, monday, at("2026-12-14T02:00:00Z"), LON).due).toBe(false); // Monday but before 03:00
    expect(scheduleState(lastMon, monday, at("2026-12-14T03:30:00Z"), LON).due).toBe(true);
    expect(scheduleState(null, monday, at("2026-12-10T12:00:00Z"), LON).due).toBe(true);
    expect(isAutoBackupDue([], monday, at("2026-12-10T12:00:00Z"), LON)).toBe(true);
  });
});

describe("running a backup", () => {
  it("writes a password-protected file that restores, leaving no half-written file", async () => {
    await db.insert(categories).values({ name: "Rent" });
    const dir = folder();
    const file = await runAutoBackup(cfg(dir, { password: "longenough" }) as never, Date.UTC(2026, 9, 7, 3, 5));
    expect(file.name).toBe("tally-auto-2026-10-07-03-05.tallybak");
    expect(fs.readdirSync(dir).filter((n) => n.includes("partial"))).toEqual([]);
    const plain = decryptBackup(fs.readFileSync(path.join(dir, file.name)), "longenough");
    const tmp = path.join(folder(), "b.db");
    fs.writeFileSync(tmp, plain);
    const opened = new Database(tmp, { readonly: true });
    expect((opened.prepare("select name from categories").get() as { name: string }).name).toBe("Rent");
    opened.close();
  });

  it("without a password (deliberately off) it writes a plain .db", async () => {
    const dir = folder();
    const file = await runAutoBackup(cfg(dir) as never);
    expect(file.name.endsWith(".db")).toBe(true);
    expect(fs.readFileSync(path.join(dir, file.name)).subarray(0, 15).toString()).toBe("SQLite format 3");
  });

  it("keeps only the newest N and never touches other files", async () => {
    const dir = folder();
    fs.writeFileSync(path.join(dir, "my-own-file.txt"), "keep");
    for (let i = 1; i <= 4; i++) {
      await runAutoBackup(cfg(dir, { keep: 2 }) as never, Date.UTC(2026, 9, i, 3, 0));
      const f = path.join(dir, `tally-auto-2026-10-0${i}-03-00.db`);
      fs.utimesSync(f, new Date(Date.UTC(2026, 9, i)), new Date(Date.UTC(2026, 9, i)));
    }
    expect(listAutoBackups(dir).map((f) => f.name)).toEqual(["tally-auto-2026-10-04-03-00.db", "tally-auto-2026-10-03-03-00.db"]);
    expect(fs.existsSync(path.join(dir, "my-own-file.txt"))).toBe(true);
  });

  it("creates the folder if it is missing", async () => {
    const dir = path.join(folder(), "nested", "backups");
    await runAutoBackup(cfg(dir) as never);
    expect(listAutoBackups(dir)).toHaveLength(1);
  });
});

describe("the scheduler uses the saved settings", () => {
  const save = (o: Record<string, unknown>) => setAutoBackupStored(JSON.stringify(o));
  const noEnv = () => {
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_PASSWORD;
  };

  it("off with no folder; paused with the switch; refuses (loudly) without a password; runs when set up", async () => {
    const saved = { ...process.env };
    try {
      noEnv();
      expect(await maybeRunAutoBackup()).toBe("off");

      const dir = folder();
      await save({ dir });
      await expect(maybeRunAutoBackup()).rejects.toThrow(/Set a password/);
      expect(listAutoBackups(dir)).toHaveLength(0);
      await expect(runAutoBackupNow()).rejects.toThrow(/Set a password/);

      await save({ dir, protect: true, passwordSealed: sealSecret("longenough") });
      await updateAppSettings({ autoBackupEnabled: false });
      expect(await maybeRunAutoBackup()).toBe("paused");
      expect(listAutoBackups(dir)).toHaveLength(0);

      await updateAppSettings({ autoBackupEnabled: true });
      expect(await maybeRunAutoBackup()).toBe("ran");
      expect(await maybeRunAutoBackup()).toBe("not-due");
      const [file] = listAutoBackups(dir);
      expect(file.name.endsWith(".tallybak")).toBe(true);
      expect(decryptBackup(fs.readFileSync(path.join(dir, file.name)), "longenough").subarray(0, 15).toString()).toBe("SQLite format 3");
    } finally {
      process.env = saved;
    }
  });

  it("'Back up now' writes immediately, even when paused or not yet due", async () => {
    const saved = { ...process.env };
    try {
      noEnv();
      const dir = folder();
      await save({ dir, protect: false });
      await updateAppSettings({ autoBackupEnabled: false });
      const a = await runAutoBackupNow();
      expect(listAutoBackups(dir).map((f) => f.name)).toContain(a.name);
    } finally {
      process.env = saved;
    }
  });

  it("status reflects what is saved, never the password itself", async () => {
    const saved = { ...process.env };
    try {
      noEnv();
      expect(await autoBackupStatus()).toMatchObject({ enabled: false, hasSaved: false });
      const dir = folder();
      await save({ dir, keep: 5, frequencyHours: 12, hour: 4, protect: true, passwordSealed: sealSecret("longenough") });
      const s = await autoBackupStatus();
      expect(s).toMatchObject({ enabled: true, protected: true, keep: 5, frequencyHours: 12, hour: 4, writable: true, hasSaved: true, due: true });
      expect(s.form).toMatchObject({ dir, keep: 5, protect: true, passwordSet: true, passwordFromEnv: false });
      expect(JSON.stringify(s)).not.toContain("longenough");
      expect(JSON.stringify(await getAutoBackupStored())).not.toContain("longenough");
    } finally {
      process.env = saved;
    }
  });
});

describe("sealed password", () => {
  it("opens with the same secret, not another, and is not plain text", () => {
    const sealed = sealSecret("longenough");
    expect(sealed.includes("longenough")).toBe(false);
    expect(openSecret(sealed)).toBe("longenough");
    const keep = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a different secret";
    expect(() => openSecret(sealed)).toThrow(/Enter it again/);
    process.env.AUTH_SECRET = keep;
  });

  it("needs AUTH_SECRET", () => {
    const keep = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    expect(() => sealSecret("longenough")).toThrow("AUTH_SECRET");
    process.env.AUTH_SECRET = keep;
  });
});
