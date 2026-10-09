import { auth } from "@/auth";
import { runWithUserDb } from "./context";
import { getOrOpenUserDb } from "./pool";
import { getUserBySub, type UserRow } from "./users";
import { openDek, dekToHex } from "../user-dek";
import type { UserConn } from "./connection";

/** The real per-user swap this whole design has been building toward: reads
 * the signed-in session's OIDC `sub` (see auth.config.ts's jwt/session
 * callbacks), looks up which account that is, and opens (or reuses) THEIR
 * OWN encrypted database file. Does NOT itself make it the active
 * connection - see `withCurrentUser` below for why.
 *
 * Fails loud, never silently falls back to someone else's data: a missing
 * session, a disabled/deleted account, or a DEK that won't open under this
 * sub (see lib/user-dek.ts) all throw rather than returning a connection. */
export async function resolveCurrentUser(): Promise<{ user: UserRow; conn: UserConn }> {
  const session = await auth();
  const sub = session?.user?.sub;
  if (!sub) throw new Error("Not signed in.");

  const user = await getUserBySub(sub);
  if (!user) throw new Error("This account no longer exists.");
  if (user.disabledAt) throw new Error("This account has been disabled.");
  if (!user.dekSealed) throw new Error("This account has no encryption key yet. Sign out and back in.");

  const dek = openDek(user.dekSealed, sub);
  const conn = getOrOpenUserDb(user.id, dekToHex(dek));
  return { user, conn };
}

/** Resolves the signed-in user's connection and runs `fn` with it active
 * for everything `fn` does, including every nested await.
 *
 * NOT `resolveCurrentUser()` followed by a bare `enterUserDb(conn)` -
 * confirmed live (not assumed) that `enterUserDb`'s `als.enterWith` does
 * NOT reliably survive into a React Server Component's own later `await`s:
 * a page that called it as its first line then threw "No user database is
 * active" two lines later, inside the SAME function, on real Next.js
 * request handling (not under test, where it always worked - the
 * difference is Next's own rendering scheduling around Server Components,
 * exactly the gap lib/db/context.ts's own comment had flagged as
 * unconfirmed). `runWithUserDb`'s `als.run` wraps `fn` as an actual child
 * scope instead of mutating the ambient one, which held up where
 * `enterWith` didn't. Every page/layout/route now wraps its whole body in
 * this rather than calling enterUserDb directly. */
export async function withCurrentUser<T>(fn: (user: UserRow) => Promise<T>): Promise<T> {
  const { user, conn } = await resolveCurrentUser();
  return runWithUserDb(conn, () => fn(user));
}
