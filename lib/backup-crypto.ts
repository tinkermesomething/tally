import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

/** Password protection for backup files: AES-256-GCM, key from the password
 * with scrypt. GCM also authenticates, so a wrong password and a damaged
 * file are both caught (never a silent garbage restore).
 *
 * Layout: "TALLYBK1" | salt(16) | iv(12) | auth tag(16) | ciphertext. */
const MAGIC = Buffer.from("TALLYBK1");
const SALT = 16;
const IV = 12;
const TAG = 16;
const KEY = 32;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

import { MAX_BACKUP_PASSWORD, MIN_BACKUP_PASSWORD } from "./backup-crypto-shared";

export function checkBackupPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_BACKUP_PASSWORD) {
    throw new Error(`Use a password of at least ${MIN_BACKUP_PASSWORD} characters.`);
  }
  if (password.length > MAX_BACKUP_PASSWORD) throw new Error("That password is too long.");
  return password;
}

export function isEncryptedBackup(data: Buffer): boolean {
  return data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBackup(plain: Buffer, password: string): Buffer {
  checkBackupPassword(password);
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(password, salt, KEY, SCRYPT), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(data: Buffer, password: string): Buffer {
  if (!isEncryptedBackup(data) || data.length < MAGIC.length + SALT + IV + TAG) throw new Error("That file isn't a protected Tally backup.");
  const salt = data.subarray(MAGIC.length, MAGIC.length + SALT);
  const iv = data.subarray(MAGIC.length + SALT, MAGIC.length + SALT + IV);
  const tag = data.subarray(MAGIC.length + SALT + IV, MAGIC.length + SALT + IV + TAG);
  const body = data.subarray(MAGIC.length + SALT + IV + TAG);
  try {
    const decipher = createDecipheriv("aes-256-gcm", scryptSync(password, salt, KEY, SCRYPT), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error("Wrong password, or the backup file is damaged.");
  }
}

/** Keeps a secret (the automatic-backup password) out of the database in
 * plain text: sealed with a key made from AUTH_SECRET, so a copy of the
 * database file alone doesn't reveal it. Not a vault - the app has to be able
 * to open it unattended - but it means a stray database copy (or a plain
 * backup) never contains the password. If AUTH_SECRET changes, the sealed
 * value can't be opened and the password must be entered again. */
function sealKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set, so a backup password can't be stored.");
  return createHash("sha256").update(`tally-backup-password-v1:${secret}`).digest();
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

export function openSecret(token: string): string {
  if (!token.startsWith("v1.")) throw new Error("The stored backup password is unreadable. Enter it again.");
  try {
    const raw = Buffer.from(token.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), raw.subarray(0, IV));
    decipher.setAuthTag(raw.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(raw.subarray(IV + TAG)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The stored backup password can't be opened (the app's secret changed?). Enter it again.");
  }
}
