/** The desktop build runs the same app as a single local user: no OIDC, no
 * other accounts, no bank sync. One env var, read in one place - the Tauri
 * launcher sets it before it spawns the server. */
export function isDesktopMode(): boolean {
  return process.env.TALLY_MODE === "desktop";
}

// Fixed identity for the one local user. Not a secret: the sealed DEK is
// bound to AUTH_SECRET too, which the launcher keeps in the OS keychain.
export const DESKTOP_SUB = "tally-desktop-local-user";
export const DESKTOP_EMAIL = "local@tally.desktop";
export const DESKTOP_NAME = "Me";
