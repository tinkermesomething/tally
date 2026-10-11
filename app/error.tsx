"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Safety net for anything a page or action throws that nothing handled
 * itself - a styled message with a way out, instead of the framework's bare
 * error screen. Expected problems (bad input) are reported inline by the
 * form that caused them; this is for real bugs.
 *
 * Always offers BOTH actions, rather than trying to tell a stale-session
 * error apart from any other kind: Next.js strips the real error message
 * for anything thrown during Server Component rendering before it ever
 * reaches this client component in a production build (confirmed directly
 * in its own source,
 * node_modules/next/dist/server/app-render/create-error-handler.js - only
 * a digest crosses that boundary, never error.message). A v4.1.1 attempt
 * to match on error.message to show "Sign in again" only for a stale
 * session looked right in `npm run dev` (where the real message DOES come
 * through) and silently never fired in the deployed build - confirmed live,
 * the same dead-end "Try again" loop recurred on v4.1.2. There is no
 * reliable client-side signal to distinguish error types in production, so
 * this stops trying to and just always offers a real sign-in alongside the
 * retry - "Try again" can't fix a condition that reruns the same broken
 * lookup every time, but a fresh sign-in replaces whatever's actually
 * wrong with the session underneath it regardless of which specific
 * check failed. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        That didn&apos;t save, or the page couldn&apos;t load. Your data is unchanged. If this is a one-off, try again - if it keeps
        happening, it&apos;s usually a session that needs refreshing, so sign in again
        {error.digest ? ` (ref ${error.digest})` : ""}.
      </p>
      <div className="flex items-center justify-center gap-2">
        <Button type="button" variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button render={<Link href="/signin">Sign in again</Link>} />
      </div>
    </div>
  );
}
