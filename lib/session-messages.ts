/** The exact Error messages lib/db/current-user.ts's resolveCurrentUser
 * throws for a session that's valid (decrypts fine) but doesn't resolve to
 * a usable account - a stale cookie outliving the account it names (one
 * device signed out and deleted, or disabled, elsewhere), not a bug and
 * not something retrying the same render ever fixes. Zero imports on
 * purpose: app/error.tsx ("use client") needs these too, and importing
 * current-user.ts itself there would pull its server-only dependencies
 * (better-sqlite3, node:crypto via user-dek) into the client bundle. */
export const SESSION_BROKEN_MESSAGES = [
  "Not signed in.",
  "This account no longer exists.",
  "This account has been disabled.",
  "This account has no encryption key yet. Sign out and back in.",
] as const;

export function isSessionBrokenMessage(message: string): boolean {
  return (SESSION_BROKEN_MESSAGES as readonly string[]).includes(message);
}
