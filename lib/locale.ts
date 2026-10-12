import { auth } from "@/auth";
import { withCurrentUser } from "./db/current-user";
import { getAppSettings, DEFAULTS } from "./db/settings";
import type { Locale } from "./locales";

/** Resolves the signed-in user's own language preference - the same
 * per-user app_settings row currency/dateFormat already live in (see
 * lib/db/settings.ts). Used by BOTH app/layout.tsx (for <html lang>) and
 * i18n/request.ts (next-intl's own config, a separate mechanism from the
 * plain Server Component tree - it can't just receive a prop from the
 * layout, it has to resolve locale itself) - factored out here so there's
 * one definition of "how do we resolve locale, with what fallback," not
 * two that can quietly drift apart.
 *
 * No session (e.g. /signin) or a session that fails to resolve (disabled/
 * deleted account - the exact edge case app/layout.tsx's own loadSettings
 * already handles for currency/dateFormat) falls back to the default
 * rather than throwing: the chrome around a broken session still needs to
 * render in SOME language. */
export async function resolveLocale(): Promise<Locale> {
  const session = await auth();
  if (!session) return DEFAULTS.locale;
  try {
    return (await withCurrentUser(() => getAppSettings())).locale;
  } catch {
    return DEFAULTS.locale;
  }
}
