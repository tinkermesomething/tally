"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { isSessionBrokenMessage } from "@/lib/session-messages";

/** Safety net for anything a page or action throws that nothing handled
 * itself - a styled message with a retry, instead of the framework's bare
 * error screen. Expected problems (bad input) are reported inline by the
 * form that caused them; this is for real bugs.
 *
 * One specific case gets its own path: a session that's valid (so the
 * person looks signed in) but no longer resolves to a real account - a
 * stale cookie outliving the account it names. "Try again" can never fix
 * that (it's not a transient failure, it reruns the same lookup forever -
 * confirmed live: this is what a stale mobile session actually did,
 * looping on the retry button with no way out). A real sign-in replaces
 * the broken cookie with a working one, so that's the way out offered
 * instead. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const sessionBroken = isSessionBrokenMessage(error.message);

  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">{sessionBroken ? "Your session needs refreshing" : "Something went wrong"}</h1>
      <p className="text-sm text-muted-foreground">
        {sessionBroken
          ? "This device is signed in with an account that no longer matches - sign in again to fix it."
          : `That didn't save, or the page couldn't load. Your data is unchanged. Try again, and if it keeps happening check the server log${error.digest ? ` (ref ${error.digest})` : ""}.`}
      </p>
      {sessionBroken ? (
        <Button render={<Link href="/signin">Sign in again</Link>} />
      ) : (
        <Button onClick={reset}>Try again</Button>
      )}
    </div>
  );
}
