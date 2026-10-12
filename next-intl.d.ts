import type { SUPPORTED_LOCALES } from "@/lib/locales";
import type en from "./messages/en.json";

// Typed translation keys/locale, checked against en.json ONLY - a
// still-incomplete it/fr/pt/de/pl file (see messages/ - every key missing
// there falls back to English at runtime) never breaks the build. That's
// the property an incremental, ongoing translation effort needs.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof SUPPORTED_LOCALES)[number];
    Messages: typeof en;
  }
}
