/** Pure decisions for resolving an OIDC login to a Tally account - no DB,
 * no network, no clock. lib/db/users.ts does the actual lookups and calls
 * this with what it found; auth.ts only applies the result and audits it.
 * Kept separate from lib/auth-rules.ts (which is about the REQUEST itself -
 * hosts, email verification) - this is about WHICH account, if any. */

export type ExistingAccount = {
  oidcSub: string | null;
  disabledAt: Date | null;
  isAdmin: boolean;
} | null;

export type SignInResolution =
  | { allow: true; action: "sign-in"; auditDetail: string }
  | { allow: true; action: "complete-invite"; auditDetail: string }
  | { allow: true; action: "create-admin"; auditDetail: string }
  | { allow: false; reason: "disabled" | "not-invited"; auditDetail: string };

/** Whether this email is the one that bootstraps the admin account - same
 * rule the single-user app used for its only login, just renamed now that
 * it means "the first admin" rather than "the only user ever allowed in". */
export function isBootstrapAdminEmail(email: string | undefined, allowedEmail: string | undefined): boolean {
  return !!email && !!allowedEmail && email.toLowerCase() === allowedEmail.toLowerCase();
}

/** Whether the OIDC profile's own "groups" claim puts this identity in the
 * admin group - the real, ongoing source of admin status (re-checked on
 * every sign-in, not just set once at account creation, so a group change
 * at the IdP takes effect on next login either way). `adminGroup` is
 * OIDC_ADMIN_GROUP (lib/db/users.ts's caller reads the env var) - "admin"
 * unless the self-hoster's own IdP already uses that name for something
 * else and they renamed it there. */
export function hasAdminGroup(groups: unknown, adminGroup: string = "admin"): boolean {
  return Array.isArray(groups) && groups.includes(adminGroup);
}

/** The actual admin decision applied on every sign-in: the group claim, OR
 * the bootstrap email - always, regardless of group - so an OIDC group
 * misconfiguration can never lock every admin out at once (the one thing
 * worse than an extra admin is zero admins able to fix it). */
export function isEffectiveAdmin(email: string | undefined, allowedEmail: string | undefined, groups: unknown, adminGroup?: string): boolean {
  return hasAdminGroup(groups, adminGroup) || isBootstrapAdminEmail(email, allowedEmail);
}

/**
 * `byEmail` is a lookup for an invited-but-never-logged-in row (oidcSub is
 * null) matching this email - only relevant when `bySub` found nothing,
 * since a sub match always takes priority (the account may have since
 * changed its email at the IdP, and that's fine - this is still the same
 * account). Both come from lib/db/users.ts's two separate queries.
 */
export function resolveSignIn(
  email: string | undefined,
  allowedEmail: string | undefined,
  bySub: ExistingAccount,
  byEmail: ExistingAccount
): SignInResolution {
  const existing = bySub ?? byEmail;
  if (existing) {
    if (existing.disabledAt) return { allow: false, reason: "disabled", auditDetail: email ?? "unknown" };
    return { allow: true, action: bySub ? "sign-in" : "complete-invite", auditDetail: email ?? "unknown" };
  }
  if (isBootstrapAdminEmail(email, allowedEmail)) {
    return { allow: true, action: "create-admin", auditDetail: email ?? "unknown" };
  }
  return { allow: false, reason: "not-invited", auditDetail: email ?? "unknown" };
}

/** An admin can disable (or delete) anyone except the account that
 * currently holds the bootstrap admin email - locking that out would mean
 * nobody can invite or re-enable anyone else (the break-glass script is
 * for OIDC itself being unreachable, not a routine way to recover from
 * this). Same rule for both actions - deleting is just less reversible. */
export function canDisable(target: { email: string; isAdmin: boolean }, allowedEmail: string | undefined): boolean {
  return !isBootstrapAdminEmail(target.email, allowedEmail);
}
export const canDelete = canDisable;

/** A new invite's email must be a real-looking address and not already
 * claimed by another account (case-insensitive - one real inbox, one
 * account, regardless of how it's capitalized). */
export function checkInviteEmail(email: string, existingEmails: string[]): string | null {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a real email address.";
  if (existingEmails.some((e) => e.toLowerCase() === trimmed.toLowerCase())) return "That email is already a Tally account.";
  return null;
}
