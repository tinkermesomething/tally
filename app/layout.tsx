import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import {
  AccentProvider,
  AccentNoFlashScript,
} from "@/components/providers/accent-provider";
import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "Tally",
  description: "Personal budget tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <AccentNoFlashScript />
      </head>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark">
          <AccentProvider>
            <AppHeader />
            <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
