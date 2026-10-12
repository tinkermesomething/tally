import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { PageContainer, WIDE_COOKIE } from "@/components/page-width";
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import {
  AccentProvider,
  AccentNoFlashScript,
} from "@/components/providers/accent-provider";
import { AppSettingsProvider } from "@/components/providers/app-settings-provider";
import { AppHeader } from "@/components/app-header";
import { Footer } from "@/components/footer";
import { getAppSettings, DEFAULTS as SETTINGS_DEFAULTS } from "@/lib/db/settings";
import { withCurrentUser } from "@/lib/db/current-user";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "Tally",
  description: "Personal budget tracker",
};

// Currency/date format are shared, DB-backed settings (not per-browser) -
// every request needs the current row, not a stale cached one.
export const dynamic = "force-dynamic";

async function loadSettings() {
  try {
    return await withCurrentUser(() => getAppSettings());
  } catch {
    // A session cookie that decrypts fine but names an account that's
    // since been disabled, deleted, or (as happens once, moving from the
    // old single-user login to this one) simply never had a per-user
    // account resolved at all - still SIGNED IN as far as auth() is
    // concerned, just broken. The chrome (this layout, AppHeader) must
    // still render enough to let them sign out and back in; only the
    // real data pages (which call withCurrentUser themselves)
    // should actually refuse to show anything.
    return SETTINGS_DEFAULTS;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The root layout wraps EVERY page, including /signin - which renders
  // for a visitor who isn't signed in yet, so there's no account to resolve
  // a connection for. Real per-user settings only when a session exists;
  // otherwise the sign-in page gets display defaults (it shows no
  // financial data anyway) rather than throwing.
  const session = await auth();
  const { currency, dateFormat, locale } = session ? await loadSettings() : SETTINGS_DEFAULTS;
  const wide = (await cookies()).get(WIDE_COOKIE)?.value === "1";

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <AccentNoFlashScript />
      </head>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark">
          <AccentProvider>
            <AppSettingsProvider currency={currency} dateFormat={dateFormat}>
              {/* Auto-inherits locale/messages from i18n/request.ts (next-intl
                  4.x) - no props to thread here. A separate provider from
                  AppSettingsProvider above on purpose: that one is this app's
                  own currency/date-formatting context, unrelated to
                  next-intl's own translation mechanism. */}
              <NextIntlClientProvider>
                <AppHeader />
                <PageContainer initialWide={wide}>{children}</PageContainer>
                <Footer />
              </NextIntlClientProvider>
            </AppSettingsProvider>
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
