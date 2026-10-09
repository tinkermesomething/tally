import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Each user's Data Encryption Key (DEK) - a random 32-byte key for their
 * own encrypted database file - sealed so it's never stored in plain text,
 * not even in the always-open keystore. Bound to BOTH `AUTH_SECRET` (the
 * same trust boundary this app already relies on for JWT signing - no new
 * assumption) AND the user's own OIDC `sub`, so two users' sealed DEKs can
 * never be swapped, and so re-linking a changed identity (lib/db/users.ts's
 * `relinkUserSub`) has to explicitly re-seal under the new sub rather than
 * the old seal silently still working under it.
 *
 * This is the frictionless half of the design: unwrapped automatically
 * whenever the session is valid, no password, no passkey. It protects a
 * STOLEN FILE (the sealed DEK alone is useless without AUTH_SECRET) - it
 * does not protect a compromised live host, which already has
 * AUTH_SECRET. That tradeoff was the user's explicit, informed choice
 * (see the security-hardening plan), not a silent downgrade. */

const IV = 12;
const TAG = 16;
const KEY = 32;

function sealingKey(sub: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set, so a user's encryption key can't be sealed.");
  return createHash("sha256").update(`tally-user-dek-v1:${sub}:${secret}`).digest();
}

export function generateDek(): Buffer {
  return randomBytes(KEY);
}

export function sealDek(dek: Buffer, sub: string): string {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(sub), iv);
  const body = Buffer.concat([cipher.update(dek), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** Throws a plain-words reason (never silently returns garbage) if the
 * seal can't be opened with this sub - a mismatched sub, a damaged value,
 * or AUTH_SECRET having changed since it was sealed all land here. */
export function openDek(sealed: string, sub: string): Buffer {
  if (!sealed.startsWith("v1.")) throw new Error("This account's encryption key is unreadable. It needs to be re-linked.");
  try {
    const raw = Buffer.from(sealed.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", sealingKey(sub), raw.subarray(0, IV));
    decipher.setAuthTag(raw.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(raw.subarray(IV + TAG)), decipher.final()]);
  } catch {
    throw new Error("This account's encryption key can't be opened for this identity. It needs to be re-linked.");
  }
}

/** Opens a DEK sealed under `oldSub` and re-seals it under `newSub` - the
 * one step `relinkUserSub` needs beyond just updating the `oidc_sub`
 * column, since the seal is bound to the sub, not just a lookup key. */
export function resealDek(sealed: string, oldSub: string, newSub: string): string {
  return sealDek(openDek(sealed, oldSub), newSub);
}

export function dekToHex(dek: Buffer): string {
  return dek.toString("hex");
}
