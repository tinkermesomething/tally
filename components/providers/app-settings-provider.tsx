"use client";

import { createContext, useContext } from "react";
import type { AppSettings } from "@/lib/db/settings";

const AppSettingsContext = createContext<AppSettings | null>(null);

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
}: AppSettings & { children: React.ReactNode }) {
  return (
    <AppSettingsContext.Provider value={{ currency, dateFormat }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): AppSettings {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return ctx;
}
