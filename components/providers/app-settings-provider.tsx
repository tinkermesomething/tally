"use client";

import { createContext, useContext } from "react";
import type { DateFormat } from "@/lib/date-format";

/** Only the client-rendered display settings - currency/dateFormat drive
 * formatPence/formatDate calls all over the client tree, so they're worth
 * a context. carryOverStartYear/Month (also on the DB-level AppSettings
 * type in lib/db/settings.ts) only ever get read server-side, when
 * building GridData or rendering the Preferences form, so they don't
 * belong in this client context at all. */
type ClientAppSettings = { currency: string; dateFormat: DateFormat };

const AppSettingsContext = createContext<ClientAppSettings | null>(null);

/** Server-fed, read-only from the client's side - the root layout fetches
 * the real values from the DB on every request and passes them in as
 * props. Unlike AccentProvider, there's no client-side state or
 * localStorage here: currency/date format are shared app data (edited via
 * the Settings page, which revalidates the root layout), not a per-browser
 * preference. */
export function AppSettingsProvider({
  currency,
  dateFormat,
  children,
}: ClientAppSettings & { children: React.ReactNode }) {
  return (
    <AppSettingsContext.Provider value={{ currency, dateFormat }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): ClientAppSettings {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return ctx;
}
