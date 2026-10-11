/** The exact Error messages lib/db/current-user.ts's resolveCurrentUser
 * throws for a session that's valid (decrypts fine) but doesn't resolve to
 * a usable account - a stale cookie outliving the account it names (one
 * device signed out and deleted, or disabled, elsewhere), not a bug and
 * not something retrying the same render ever fixes.
 *
 * Named constants only, no client-side matching on these anymore: Next.js
 * strips the real error message for anything thrown during Server
 * Component rendering before it reaches a production client (see
 * app/error.tsx's own comment) - a message these constants exist to keep
 * consistent and grep-able in server logs and dev-mode output, where the
 * real text does still show. */
export const SESSION_BROKEN_MESSAGES = [
  "Not signed in.",
  "This account no longer exists.",
  "This account has been disabled.",
  "This account has no encryption key yet. Sign out and back in.",
] as const;
