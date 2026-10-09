/** Pure decisions auth.ts's callbacks delegate to, so they're testable
 * without NextAuth's own machinery (which only exposes {handlers, auth,
 * signIn, signOut} - the config object's callbacks aren't reachable from
 * outside it). No DB, no network, no clock of its own. */

/** Parses ALLOWED_HOSTS (comma-separated, case-insensitive) into a list. */
export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** The request's own Host (or X-Forwarded-Host), if and only if it's one of
 * the hosts this app is meant to answer for - otherwise undefined, same as
 * "no host known yet". Never hands back an arbitrary caller-supplied value:
 * that's what let a request steer the OAuth redirect_uri / post-login
 * redirect to an origin of its choosing. */
export function allowedHostFrom(rawHost: string | null | undefined, allowedHosts: string[]): string | undefined {
  const host = rawHost?.toLowerCase();
  return host && allowedHosts.includes(host) ? host : undefined;
}

export type ProfileCheck = { ok: boolean; auditDetail: string };

/** Checks about the OIDC identity ITSELF, before accounts-rules.ts ever
 * asks "which account is this" - a missing `sub` (nothing to key a
 * database file on) or an unverified email (the provider hasn't confirmed
 * the account holder controls it - they may have changed it to something
 * that happens to collide with an invite before ever confirming it) are
 * both refused here, upstream of any account lookup. */
export function checkProfile(profile: { sub?: string | null; email?: string | null; email_verified?: boolean | null } | undefined): ProfileCheck {
  const email = profile?.email?.toLowerCase();
  if (!profile?.sub) return { ok: false, auditDetail: `${email ?? "unknown"}: no sub claim` };
  if (profile.email_verified === false) return { ok: false, auditDetail: `${email ?? "unknown"}: email not verified` };
  return { ok: true, auditDetail: email ?? "unknown" };
}
