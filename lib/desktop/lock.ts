import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { systemDbPath } from "@/lib/db/system-connection";
import { checkRateLimit } from "@/lib/rate-limit";
import { isDesktopMode } from "@/lib/desktop/mode";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/desktop/password-rules";

// The optional desktop app lock: a password asked for when Tally opens.
//
// What it is: a gate on the app window (see lib/desktop/gate.ts - with a
// lock set, the window starts "locked" and only reaches /unlock until the
// password is entered). What it is NOT: encryption. The data key still
// lives in the OS keychain, so this keeps out someone at your unlocked
// computer, not malware running as you. The Settings screen says so.
//
// The hash lives in a file beside the databases rather than the keychain
// or the database itself: no extra moving part, and recovery from a
// forgotten password is "delete app-lock.json" - safe, because the lock
// never protected the data's encryption in the first place.

export { MIN_PASSWORD_LENGTH } from "@/lib/desktop/password-rules";
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

type LockRecord = { v: 1; salt: string; hash: string; N: number; r: number; p: number };

/** Next to the system database. */
export function lockFilePath(): string {
  return path.join(path.dirname(systemDbPath()), "app-lock.json");
}

/** True whenever the file exists - even a damaged one. A lock that can't be
 * read must keep the app locked, never quietly open it. */
export function isLockEnabled(): boolean {
  return fs.existsSync(lockFilePath());
}

/** Desktop with an app lock set - the only time the unlock screen means anything. */
export function desktopLockActive(): boolean {
  return isDesktopMode() && isLockEnabled();
}

const MAX_ATTEMPTS_PER_WINDOW = 5;
const ATTEMPT_WINDOW_MS = 60_000;

/** Counts one password attempt in `bucket`. A message when over the limit, else null.
 * A local program can't get here without the launch token, so this is defence in
 * depth: it just stops a script hammering the password. */
export function lockAttemptError(bucket: string): string | null {
  return checkRateLimit(bucket, MAX_ATTEMPTS_PER_WINDOW, ATTEMPT_WINDOW_MS).allowed ? null : "Too many attempts. Wait a minute and try again.";
}

function derive(password: string, salt: Buffer, p: Pick<LockRecord, "N" | "r" | "p">): Buffer {
  return scryptSync(password, salt, SCRYPT.keyLength, { N: p.N, r: p.r, p: p.p, maxmem: SCRYPT_MAXMEM });
}

export function checkNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

/** Sets or replaces the lock password. Written to a temp file and renamed,
 * so a crash never leaves a half-written (and therefore unreadable) lock. */
export function setLockPassword(password: string): void {
  const problem = checkNewPassword(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const record: LockRecord = { v: 1, salt: salt.toString("base64"), hash: derive(password, salt, SCRYPT).toString("base64"), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
  const file = lockFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** False for a wrong password AND for a missing or damaged lock file. */
export function verifyLockPassword(password: string): boolean {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  let record: LockRecord;
  try {
    record = JSON.parse(fs.readFileSync(lockFilePath(), "utf8"));
    if (record.v !== 1) return false;
    const expected = Buffer.from(record.hash, "base64");
    const actual = derive(password, Buffer.from(record.salt, "base64"), record);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function removeLock(): void {
  fs.rmSync(lockFilePath(), { force: true });
}
