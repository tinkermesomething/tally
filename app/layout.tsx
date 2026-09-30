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
import { getAppSettings } from "@/lib/db/settings";

export const metadata: Metadata = {
  title: "Tally",
  description: "Personal budget tracker",
};

// Currency/date format are shared, DB-backed settings (not per-browser) -
// every request needs the current row, not a stale cached one.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { currency, dateFormat } = await getAppSettings();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <AccentNoFlashScript />
      </head>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark">
          <AccentProvider>
            <AppSettingsProvider currency={currency} dateFormat={dateFormat}>
              <AppHeader />
              <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
              <Footer />
            </AppSettingsProvider>
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
