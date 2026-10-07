import path from "node:path";
import { lastSyncSlot, nextSyncSlot, weekdayOf } from "./sync-schedule";
import { MIN_BACKUP_PASSWORD } from "./backup-crypto-shared";

/** The user's automatic-backup choices (Settings > Backup) and the schedule
 * they mean. Pure - no files, no database - so it can be tested by itself. */

export const FREQUENCIES = [
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Every day" },
  { hours: 48, label: "Every 2 days" },
  { hours: 168, label: "Every week" },
] as const;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MAX_KEEP = 365;

/** What is saved in the database. Anything missing falls back to the stack's
 * environment (BACKUP_*) and then to the built-in default. */
export type StoredBackupConfig = {
  dir?: string;
  frequencyHours?: number;
  hour?: number;
  weekday?: number;
  keep?: number;
  /** true = lock with the sealed password, false = no password, absent = follow BACKUP_PASSWORD. */
  protect?: boolean;
  passwordSealed?: string;
};

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const validFrequency = (v: unknown): v is number => FREQUENCIES.some((f) => f.hours === v);

/** Tolerant: a damaged or hand-edited value is ignored, never a crash. */
export function parseStored(json: string | null | undefined): StoredBackupConfig {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: StoredBackupConfig = {};
  if (typeof r.dir === "string" && r.dir.trim()) out.dir = r.dir;
  if (validFrequency(r.frequencyHours)) out.frequencyHours = r.frequencyHours;
  if (isInt(r.hour, 0, 23)) out.hour = r.hour;
  if (isInt(r.weekday, 0, 6)) out.weekday = r.weekday;
  if (isInt(r.keep, 1, MAX_KEEP)) out.keep = r.keep;
  if (typeof r.protect === "boolean") out.protect = r.protect;
  if (typeof r.passwordSealed === "string") out.passwordSealed = r.passwordSealed;
  return out;
}

export type BackupSettingsInput = {
  dir: string;
  frequencyHours: number;
  hour: number;
  weekday: number;
  keep: number;
  protect: boolean;
  /** Only when it is being set or changed; empty keeps the saved one. */
  password?: string;
};

/** Checks what the form sent and returns what to save. Throws a plain-words
 * reason for anything wrong. `seal` turns a password into its stored form;
 * `envHasPassword` says whether the stack's .env already provides one. */
export function validateSettingsInput(
  input: BackupSettingsInput,
  existing: StoredBackupConfig,
  { seal, envHasPassword }: { seal: (plain: string) => string; envHasPassword: boolean }
): StoredBackupConfig {
  const dir = typeof input.dir === "string" ? input.dir.trim() : "";
  if (!dir) throw new Error("Enter the folder to save backups to.");
  if (dir.includes("\0")) throw new Error("That folder isn't valid.");
  if (!path.isAbsolute(dir)) throw new Error("Use a full path starting with / (for example /app/backups).");
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) throw new Error("Choose a folder, not the top of the disk.");
  if (!validFrequency(input.frequencyHours)) throw new Error("Pick how often to back up.");
  if (!isInt(input.hour, 0, 23)) throw new Error("Pick an hour from 0 to 23.");
  if (!isInt(input.weekday, 0, 6)) throw new Error("Pick a day of the week.");
  if (!isInt(input.keep, 1, MAX_KEEP)) throw new Error(`Keep between 1 and ${MAX_KEEP} backups.`);

  const out: StoredBackupConfig = { dir: resolved, frequencyHours: input.frequencyHours, hour: input.hour, weekday: input.weekday, keep: input.keep, protect: !!input.protect };
  if (input.protect) {
    const typed = typeof input.password === "string" ? input.password : "";
    if (typed) {
      if (typed.length < MIN_BACKUP_PASSWORD) throw new Error(`Use a password of at least ${MIN_BACKUP_PASSWORD} characters.`);
      out.passwordSealed = seal(typed);
    } else if (existing.protect === true && existing.passwordSealed) {
      out.passwordSealed = existing.passwordSealed;
    } else if (existing.protect === undefined && envHasPassword) {
      // protection was following BACKUP_PASSWORD; keep following it
      delete out.protect;
    } else {
      throw new Error("Enter a password to protect the backups with.");
    }
  }
  return out;
}

// ---- schedule ----

export type Schedule = { frequencyHours: number; hour: number; weekday: number };
const DAY = 24 * 60 * 60 * 1000;
// Clocks changing makes "N days later" 23 or 25 hours long; this keeps a
// backup from being judged due a day early.
const DST_GRACE = 3 * 60 * 60 * 1000;

/** Is a backup due now, and when is the next one? `latest` is when the newest
 * automatic backup was written (null = none yet). A backup missed while the
 * app was off is due as soon as it is back. When due, nextAt is `now`. */
export function scheduleState(latest: number | null, s: Schedule, now: number, timeZone?: string): { due: boolean; nextAt: number } {
  const never = latest === null;

  if (s.frequencyHours < 24) {
    const slot = lastSyncSlot(now, s.frequencyHours, timeZone, s.hour);
    const due = never || latest < slot;
    return { due, nextAt: due ? now : nextSyncSlot(now, s.frequencyHours, timeZone, s.hour) };
  }

  if (s.frequencyHours === 168) {
    let last = lastSyncSlot(now, 24, timeZone, s.hour);
    for (let i = 0; i < 8 && weekdayOf(last, timeZone) !== s.weekday; i++) last = lastSyncSlot(last - 1, 24, timeZone, s.hour);
    const due = never || latest < last;
    let next = nextSyncSlot(now, 24, timeZone, s.hour);
    for (let i = 0; i < 8 && weekdayOf(next, timeZone) !== s.weekday; i++) next = nextSyncSlot(next, 24, timeZone, s.hour);
    return { due, nextAt: due ? now : next };
  }

  // every 1 or 2 days: a daily slot, but only when enough days have passed
  const days = s.frequencyHours / 24;
  const gap = days > 1 ? (days - 1) * DAY + DST_GRACE : 0;
  const slot = lastSyncSlot(now, 24, timeZone, s.hour);
  const due = never || latest < slot - gap;
  let next = nextSyncSlot(now, 24, timeZone, s.hour);
  for (let i = 0; i < 10 && !(never || latest < next - gap); i++) next = nextSyncSlot(next, 24, timeZone, s.hour);
  return { due, nextAt: due ? now : next };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The schedule in words, e.g. "Every week on Monday at 03:00 (Europe/London)". */
export function describeSchedule(s: Schedule, timeZone: string): string {
  const at = `${pad(s.hour)}:00 (${timeZone})`;
  if (s.frequencyHours < 24) return `Every ${s.frequencyHours} hours from ${at}`;
  if (s.frequencyHours === 168) return `Every week on ${WEEKDAYS[s.weekday]} at ${at}`;
  if (s.frequencyHours === 48) return `Every 2 days at ${at}`;
  return `Every day at ${at}`;
}
