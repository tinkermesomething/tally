"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Safety net for anything a page or action throws that nothing handled
 * itself - a styled message with a retry, instead of the framework's bare
 * error screen. Expected problems (bad input) are reported inline by the
 * form that caused them; this is for real bugs. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        That didn&apos;t save, or the page couldn&apos;t load. Your data is unchanged. Try again, and if it keeps
        happening check the server log{error.digest ? ` (ref ${error.digest})` : ""}.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
