import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next.js auto-externalizes well-known native-addon packages (plain
  // better-sqlite3 is already on that built-in list) so their compiled
  // .node binding resolves via real node_modules paths at runtime instead
  // of being bundled - which breaks native bindings entirely (confirmed
  // live: bundled, its bindings loader searched inside .next/build/... for
  // the .node file instead of node_modules). better-sqlite3-multiple-ciphers
  // isn't on that built-in list, so it needs adding explicitly.
  serverExternalPackages: ["better-sqlite3-multiple-ciphers"],
  // Don't advertise the framework in responses - no security value in
  // hiding it, but no value in volunteering it either.
  poweredByHeader: false,
  // A CSV import sends the whole parsed file in one request (up to 20,000
  // rows); the 1MB default would reject a long statement.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // This app is never meant to be framed by anything - no legit
          // use case, and it rules out clickjacking outright.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Stops a browser guessing a response's type from its content
          // and running it as something it wasn't served as (e.g. a
          // SELECT'able error payload treated as HTML/script).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Never leak this app's own URLs to a link a user clicks away to
          // - only the origin, and only on a real navigation. General
          // defense in depth: this app's URLs don't carry secrets today,
          // but a query param added later easily could.
          { key: "Referrer-Policy", value: "same-origin" },
          // No reason for this app to ever use the camera, mic, geolocation
          // etc; an embedded script able to run here gets none of them.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

// Points next-intl at i18n/request.ts (its default location) - this is
// the only wiring needed on the build side; no [locale] routing, no
// middleware (see i18n/request.ts's own comment for why).
const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
