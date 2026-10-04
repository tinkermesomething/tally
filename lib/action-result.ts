/** Server actions that take free-form user input return this instead of
 * throwing. Next.js's guidance: model EXPECTED errors (bad input) as return
 * values, and keep throws for real bugs, which go to the error boundary -
 * and a thrown error's message is not reliably delivered to the client in
 * production builds, so a returned message is the only dependable way to
 * tell the user what was wrong. */
export type ActionResult = { ok: true } | { ok: false; error: string };

function isDatabaseError(err: unknown): boolean {
  return err instanceof Error && "code" in err && String((err as { code: unknown }).code).startsWith("SQLITE_");
}

/** Runs an action body, turning a thrown validation error into
 * { ok: false, error }. Database errors are bugs, not user mistakes: they
 * are logged and replaced with a generic message (no table/column names). */
export async function toResult(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (isDatabaseError(err)) {
      console.error("[action] database error:", err);
      return { ok: false, error: "Something went wrong saving that. Try again." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

/** Client side: runs an action and gives back the failure message, or null
 * on success. Also catches a throw, so one call site handles both styles. */
export async function runAction(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    const res = await fn();
    const result = res as Partial<ActionResult> | null | undefined;
    if (result && result.ok === false) return result.error ?? "Something went wrong.";
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Something went wrong.";
  }
}
