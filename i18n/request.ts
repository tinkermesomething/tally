import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "@/lib/locale";
import type { Locale } from "@/lib/locales";

// Explicit, one import() call per locale with a fully STATIC string
// literal - NOT `import(\`../messages/${locale}.json\`)`. Confirmed the
// hard way: that fully-dynamic form built clean under next build
// --turbopack with no error, but `find .next/standalone -name '*.json'
// -path '*messages*'` turned up NOTHING - the bundler's static analysis
// can't resolve a variable template-literal path, so none of
// messages/*.json ever made it into the production output at all. Every
// call below has a literal path a bundler can actually see, so each file
// gets its own traceable import and ships correctly.
const MESSAGE_LOADERS: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("../messages/en.json"),
  it: () => import("../messages/it.json"),
  fr: () => import("../messages/fr.json"),
  pt: () => import("../messages/pt.json"),
  de: () => import("../messages/de.json"),
  pl: () => import("../messages/pl.json"),
};

/** Deliberately no [locale] URL segment and no next-intl routing
 * middleware - this is a single-instance self-hosted app with a live
 * Komodo deployment, a GoCardless OAuth callback URL, and bookmarked
 * links; restructuring every route under /it/, /fr/, etc. would break all
 * of them for an app that's never publicly indexed, so there's no SEO
 * upside to chase. middleware.ts is also already a deliberately minimal,
 * Edge-only Auth.js instance (see its own comment - a real Turbopack
 * build failure once DB-touching code reached it) that next-intl's own
 * routing middleware has no business anywhere near.
 *
 * Instead: locale is just another per-user app_settings value (same table
 * currency/dateFormat already live in), resolved here exactly the way
 * next-intl's own docs show for a database-backed locale (their
 * multi-tenant example resolves it from a tenant lookup the same shape -
 * confirmed against the current docs via Context7, not assumed). */
export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await MESSAGE_LOADERS[locale]()).default,
  };
});
