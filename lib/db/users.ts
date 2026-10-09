import { eq, isNull } from "drizzle-orm";
import fs from "node:fs";
import { getSystemConn } from "./system-connection";
import { closeAndForget, fileFor } from "./pool";
import { users } from "./schema";
import { resolveSignIn, isEffectiveAdmin, canDelete, type ExistingAccount, type SignInResolution } from "../accounts-rules";
import { generateDek, resealDek, sealDek } from "../user-dek";
import { audit } from "../audit";

/** Every function here uses the shared keystore connection directly
 * (lib/db/system-connection.ts), never the ambient per-request `db`
 * (lib/db/index.ts) - an admin action's own per-user context must never be
 * mistaken for the shared `users` table, and resolving a sign-in happens
 * before any per-user context exists at all. */
const sysDb = () => getSystemConn().db;

export type UserRow = typeof users.$inferSelect;

function toExisting(row: UserRow | undefined): ExistingAccount {
  if (!row) return null;
  return { oidcSub: row.oidcSub, disabledAt: row.disabledAt, isAdmin: row.isAdmin };
}

/** Resolves an OIDC login to an account decision (see accounts-rules.ts)
 * and, when it's allowed, applies whatever the resolution implies: links an
 * invited row to the sub that just logged in (generating their DEK right
 * then - their encrypted file starts empty, created the first time it's
 * opened), or creates the bootstrap admin on their very first login
 * (same - a fresh DEK, an empty file; the LIVE admin's existing data is
 * carried over separately, once, by scripts/migrate-to-per-user.ts, not by
 * this everyday login path). Returns the account row for an allowed
 * login, or null for a refused one. */
export async function resolveAndApplySignIn(
  email: string | undefined,
  sub: string,
  name: string | undefined,
  allowedEmail: string | undefined,
  /** pocket-id's own "groups" claim, unverified shape at this layer (see
   * lib/accounts-rules.ts's hasAdminGroup) - whatever profile.groups was on
   * the OIDC profile, straight from auth.ts's signIn callback. */
  groups?: unknown
): Promise<{ resolution: SignInResolution; user: UserRow | null }> {
  const db = sysDb();
  const bySub = await db.query.users.findFirst({ where: eq(users.oidcSub, sub) });
  // Case-insensitive, resolved in JS (not SQL COLLATE) - same approach the
  // rest of this app uses for email matching (see the old single-user
  // ALLOWED_EMAIL check this replaces).
  const byEmail =
    !bySub && email
      ? (await db.query.users.findMany({ where: isNull(users.oidcSub) })).find((u) => u.email.toLowerCase() === email.toLowerCase())
      : undefined;

  const resolution = resolveSignIn(email, allowedEmail, toExisting(bySub), toExisting(byEmail));
  if (!resolution.allow) return { resolution, user: null };

  // Re-derived on EVERY sign-in, not just at creation - a group change at
  // the IdP (promoted or demoted) takes effect on next login, the same way
  // disabling an account takes effect on next request, not next re-login.
  // BUT only when `groups` is actually an array this time: a scope not
  // granted, or a one-off IdP hiccup that omits the claim entirely, must
  // never read as "removed from every group" and silently demote someone -
  // that's a stale-sealed-claim threat, not the same question as what to
  // do with a claim that's genuinely present and says "no admin group".
  // An existing admin keeps their status through a missing claim; a
  // brand-new row (no existing row to fall back to) just starts as
  // whatever the bootstrap-email rule alone says.
  const effectiveAdminFor = (existingIsAdmin: boolean) =>
    Array.isArray(groups) ? isEffectiveAdmin(email, allowedEmail, groups) : existingIsAdmin || isEffectiveAdmin(email, allowedEmail, undefined);

  if (resolution.action === "sign-in") {
    const effectiveAdmin = effectiveAdminFor(bySub!.isAdmin);
    if (bySub!.isAdmin === effectiveAdmin) return { resolution, user: bySub! };
    const [updated] = await db.update(users).set({ isAdmin: effectiveAdmin }).where(eq(users.id, bySub!.id)).returning();
    return { resolution, user: updated };
  }

  if (resolution.action === "complete-invite") {
    const effectiveAdmin = effectiveAdminFor(byEmail!.isAdmin);
    const dekSealed = sealDek(generateDek(), sub);
    const [updated] = await db.update(users).set({ oidcSub: sub, name: name ?? byEmail!.email, isAdmin: effectiveAdmin, dekSealed }).where(eq(users.id, byEmail!.id)).returning();
    return { resolution, user: updated };
  }

  // create-admin: first-ever login of the bootstrap admin email. No
  // existing row to fall back to - isBootstrapAdminEmail alone already
  // guarantees true here regardless of groups (see isEffectiveAdmin).
  const dekSealed = sealDek(generateDek(), sub);
  const [created] = await db
    .insert(users)
    .values({ oidcSub: sub, email: email!, name: name ?? email, isAdmin: effectiveAdminFor(false), dekSealed })
    .returning();
  return { resolution, user: created };
}

export async function getUserBySub(sub: string): Promise<UserRow | undefined> {
  return sysDb().query.users.findFirst({ where: eq(users.oidcSub, sub) });
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  return sysDb().query.users.findFirst({ where: eq(users.id, id) });
}

export async function listUsers(): Promise<UserRow[]> {
  return sysDb().query.users.findMany({ orderBy: (u, { asc }) => [asc(u.createdAt)] });
}

/** Invites someone by email - an empty row they complete on their first
 * real login (see resolveAndApplySignIn's "complete-invite" path). No DEK
 * yet: generated only once they actually log in, since it's only needed
 * the moment their own encrypted file is first opened. */
export async function inviteUser(email: string): Promise<UserRow> {
  const [created] = await sysDb().insert(users).values({ email: email.trim(), isAdmin: false }).returning();
  return created;
}

export async function setUserDisabled(id: number, disabled: boolean) {
  await sysDb().update(users).set({ disabledAt: disabled ? new Date() : null }).where(eq(users.id, id));
}

/** Re-links an existing account to a DIFFERENT oidc_sub (the pocket-id
 * identity changed) - the account and its data are untouched, only which
 * login opens it. Refuses a sub already claimed by another row. Also
 * re-seals the DEK under the new sub (the seal is bound to the sub, not
 * just a lookup key - see lib/user-dek.ts) so the account can still be
 * unlocked afterward; an account that never logged in yet (no DEK sealed)
 * has nothing to re-seal. */
export async function relinkUserSub(id: number, newSub: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = sysDb();
  const clash = await db.query.users.findFirst({ where: eq(users.oidcSub, newSub) });
  if (clash && clash.id !== id) return { ok: false, error: "That identity is already linked to a different account." };
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) return { ok: false, error: "That account no longer exists." };
  const dekSealed = target.dekSealed && target.oidcSub ? resealDek(target.dekSealed, target.oidcSub, newSub) : target.dekSealed;
  await db.update(users).set({ oidcSub: newSub, dekSealed }).where(eq(users.id, id));
  return { ok: true };
}

/** Permanently removes an account AND its encrypted data file - unlike
 * setUserDisabled, there is no undo. Refuses the bootstrap admin (same
 * rule as disabling - see canDelete) and refuses deleting yourself
 * (callerId), so an admin can never lock themselves out this way. Closes
 * any open pool connection first - deleting the file out from under a
 * live better-sqlite3 handle is undefined behaviour, not just risky. */
export async function deleteUser(id: number, callerId: number, allowedEmail: string | undefined): Promise<{ ok: true } | { ok: false; error: string }> {
  if (id === callerId) return { ok: false, error: "You can't delete your own account." };
  const db = sysDb();
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) return { ok: false, error: "That account no longer exists." };
  if (!canDelete({ email: target.email, isAdmin: target.isAdmin }, allowedEmail)) {
    return { ok: false, error: "That account can't be deleted." };
  }
  closeAndForget(id);
  fs.rmSync(fileFor(id), { force: true });
  fs.rmSync(`${fileFor(id)}-wal`, { force: true });
  fs.rmSync(`${fileFor(id)}-shm`, { force: true });
  await db.delete(users).where(eq(users.id, id));
  await audit("user_deleted", target.email);
  return { ok: true };
}

export async function setAvatarColor(id: number, color: string | null) {
  await sysDb().update(users).set({ avatarColor: color }).where(eq(users.id, id));
}
