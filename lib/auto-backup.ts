import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBackupPassword, encryptBackup, openSecret } from "./backup-crypto";
import { writeBackup } from "./db/backup";
import { getAppSettings, getAutoBackupStored } from "./db/settings";
import { parseStored, scheduleState, type StoredBackupConfig } from "./auto-backup-settings";
import { syncTimeZone } from "./sync-schedule";
import { enterUserDb } from "./db/context";
import { getLegacyConn } from "./db/legacy-connection";

/** Automatic backups into a folder on the server.
 *
 * Everything is set in Settings > Backup and saved in the database. The
 * stack's .env (BACKUP_DIR, BACKUP_PASSWORD, BACKUP_HOUR, BACKUP_KEEP) only
 * supplies the starting values, so a fresh install can be pre-wired; anything
 * saved in Settings wins. Backups are password-protected: with no password
 * available (and protection not deliberately switched off) nothing is written. */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const BOOT_CHECK_DELAY_MS = 90 * 1000;
export const AUTO_PREFIX = "tally-auto-";

export type AutoBackupConfig = {
  dir: string;
  /** null = deliberately unprotected. */
  password: string | null;
  frequencyHours: number;
  hour: number;
  weekday: number;
  keep: number;
};

export type Env = Record<string, string | undefined>;
const envInt = (v: string | undefined, min: number, max: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/** The settings in force: what was saved, else the .env, else the defaults.
 * `config` is null when no folder is set (automatic backups are not set up);
 * `problem` says why nothing can be written (e.g. no password yet). */
export function resolveAutoBackupConfig(stored: StoredBackupConfig, env: Env = process.env): { config: AutoBackupConfig | null; problem: string | null; source: { dir: "saved" | "env" | "none"; password: "saved" | "env" | "none" | "off" } } {
  const envDir = env.BACKUP_DIR?.trim();
  const dir = stored.dir ?? (envDir ? envDir : undefined);
  const source = { dir: stored.dir ? ("saved" as const) : envDir ? ("env" as const) : ("none" as const), password: "none" as "saved" | "env" | "none" | "off" };
  if (!dir) return { config: null, problem: null, source };

  let password: string | null = null;
  let problem: string | null = null;
  if (stored.protect === false) {
    source.password = "off";
  } else if (stored.protect === true && stored.passwordSealed) {
    source.password = "saved";
    try {
      password = openSecret(stored.passwordSealed);
    } catch (err) {
      problem = err instanceof Error ? err.message : "The backup password can't be read.";
    }
  } else if (env.BACKUP_PASSWORD) {
    source.password = "env";
    try {
      password = checkBackupPassword(env.BACKUP_PASSWORD);
    } catch (err) {
      problem = `BACKUP_PASSWORD in the .env: ${(err as Error).message}`;
    }
  } else {
    problem = "Set a password to protect the automatic backups (or turn protection off).";
  }

  return {
    config: {
      dir: path.resolve(dir),
      password,
      frequencyHours: stored.frequencyHours ?? 24,
      hour: stored.hour ?? envInt(env.BACKUP_HOUR, 0, 23) ?? 3,
      weekday: stored.weekday ?? 1,
      keep: stored.keep ?? envInt(env.BACKUP_KEEP, 1, 365) ?? 14,
    },
    problem,
    source,
  };
}

export type BackupFile = { name: string; size: number; modifiedAt: number };

/** The automatic backups in the folder, newest first. */
export function listAutoBackups(dir: string): BackupFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(AUTO_PREFIX) && (n.endsWith(".db") || n.endsWith(".tallybak")))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, modifiedAt: st.mtimeMs };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Is a backup due? Pure wrapper so it is testable with plain file lists. */
export function isAutoBackupDue(files: BackupFile[], config: Pick<AutoBackupConfig, "frequencyHours" | "hour" | "weekday">, now: number = Date.now(), timeZone?: string): boolean {
  return scheduleState(files[0]?.modifiedAt ?? null, config, now, timeZone).due;
}

/** Writes one backup into the folder and prunes the oldest beyond `keep`.
 * The file appears under its final name only once it is complete (written
 * under a temporary name, then renamed), so a crash never leaves a half
 * backup that looks real. Refuses to write without a password unless
 * protection was deliberately switched off. */
export async function runAutoBackup(config: AutoBackupConfig, now: number = Date.now()): Promise<BackupFile> {
  fs.mkdirSync(config.dir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-auto-"));
  try {
    const raw = path.join(tmpDir, "backup.db");
    await writeBackup(raw);
    const plain = fs.readFileSync(raw);
    const body = config.password ? encryptBackup(plain, config.password) : plain;
    const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const name = `${AUTO_PREFIX}${stamp}.${config.password ? "tallybak" : "db"}`;
    const partial = path.join(config.dir, `.${name}.partial`);
    fs.writeFileSync(partial, body, { mode: 0o600 });
    fs.renameSync(partial, path.join(config.dir, name));
    const kept = listAutoBackups(config.dir);
    for (const old of kept.slice(config.keep)) fs.rmSync(path.join(config.dir, old.name), { force: true });
    const st = fs.statSync(path.join(config.dir, name));
    return { name, size: st.size, modifiedAt: st.mtimeMs };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function currentConfig() {
  return resolveAutoBackupConfig(parseStored(await getAutoBackupStored()));
}

/** Writes a backup right now (the "Back up now" button), ignoring the
 * schedule and the pause switch - it is a manual action. Throws the reason
 * if it can't. */
export async function runAutoBackupNow(): Promise<BackupFile> {
  const { config, problem } = await currentConfig();
  if (!config) throw new Error("Choose a folder first.");
  if (problem) throw new Error(problem);
  return runAutoBackup(config);
}

/** One scheduler tick: writes a backup if one is due. Returns why it did or
 * didn't, so the decision is testable. */
export async function maybeRunAutoBackup(now: number = Date.now()): Promise<"ran" | "off" | "paused" | "not-due"> {
  const { config, problem } = await currentConfig();
  if (!config) return "off";
  if (!(await getAppSettings()).autoBackupEnabled) return "paused";
  if (problem) throw new Error(problem);
  if (!isAutoBackupDue(listAutoBackups(config.dir), config, now)) return "not-due";
  await runAutoBackup(config, now);
  return "ran";
}

let started = false;
let running = false;
let lastError: string | null = null;

async function checkAndMaybeBackup() {
  if (running) return;
  running = true;
  try {
    // Each timer firing is its own fresh call - establishes its own
    // connection rather than assume one carried over from whatever
    // scheduled the timer (see lib/db/legacy-connection.ts).
    enterUserDb(getLegacyConn());
    await maybeRunAutoBackup();
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Backup failed";
    console.error("[auto-backup] failed:", err);
  } finally {
    running = false;
  }
}

/** Starts the in-process loop (once per server process). Missed while the
 * app was off? It runs shortly after the next start. */
export function startAutoBackup() {
  if (started) return;
  started = true;
  setTimeout(checkAndMaybeBackup, BOOT_CHECK_DELAY_MS);
  setInterval(checkAndMaybeBackup, CHECK_INTERVAL_MS);
}

/** What the Settings page shows and the form starts from. */
export async function autoBackupStatus(now: number = Date.now()) {
  const stored = parseStored(await getAutoBackupStored());
  const paused = !(await getAppSettings()).autoBackupEnabled;
  const { config, problem, source } = resolveAutoBackupConfig(stored);
  const env = process.env;
  const base = {
    paused,
    timeZone: syncTimeZone(),
    // values the form starts with (the saved ones, else what applies now, else the defaults)
    form: {
      dir: config?.dir ?? "",
      frequencyHours: config?.frequencyHours ?? 24,
      hour: config?.hour ?? 3,
      weekday: config?.weekday ?? 1,
      keep: config?.keep ?? 14,
      protect: stored.protect !== false,
      passwordSet: source.password === "saved" || source.password === "env",
      passwordFromEnv: source.password === "env",
    },
    envDir: env.BACKUP_DIR?.trim() || null,
    hasSaved: Object.keys(stored).length > 0,
  };
  if (!config) return { ...base, enabled: false as const };
  const files = listAutoBackups(config.dir);
  let writable = true;
  try {
    fs.mkdirSync(config.dir, { recursive: true });
    fs.accessSync(config.dir, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  const state = scheduleState(files[0]?.modifiedAt ?? null, config, now);
  return {
    ...base,
    enabled: true as const,
    dir: config.dir,
    protected: config.password !== null,
    keep: config.keep,
    frequencyHours: config.frequencyHours,
    hour: config.hour,
    weekday: config.weekday,
    due: state.due,
    nextAt: state.nextAt,
    files: files.slice(0, 5),
    total: files.length,
    writable,
    problem,
    lastError,
  };
}
