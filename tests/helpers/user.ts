import { resolveAndApplySignIn } from "@/lib/db/users";
import { resolveCurrentUser } from "@/lib/db/current-user";
import { runWithUserDb } from "@/lib/db/context";

/** Seeds a real account (system connection row + sealed DEK) the same way
 * a genuine first login does, for tests that exercise code past
 * resolveAndEnterCurrentUser - a fake `@/auth` session alone isn't enough
 * once a route/action actually resolves a per-user encrypted connection
 * from `session.user.sub`, not just checks that a session exists. */
export async function seedSignedInUser(sub = "test-sub", email = "t@t") {
  const { user } = await resolveAndApplySignIn(email, sub, "Test User", email);
  if (!user) throw new Error("seedSignedInUser: resolveAndApplySignIn refused this sign-in");
  return user;
}

/** Wraps an `it()` callback so the WHOLE test body runs with the real
 * per-user connection active, via `runWithUserDb` (`als.run`) rather than
 * `enterUserDb` (`als.enterWith`). Confirmed live (not assumed) that a
 * SECOND `enterWith` call in a `beforeEach` - even one that works
 * perfectly in plain Node, see the standalone repro this comment refers
 * to - does not reliably survive Vitest's own beforeEach-to-it scheduling
 * boundary (the resetDb() in tests/helpers/db.ts has its own enterWith,
 * called synchronously with nothing before it in that hook, which DOES
 * survive - the fragile case is specifically a second one, after some
 * awaits, overwriting it). Doing the whole resolve-and-run inside the
 * test body itself, with no hook boundary in between, is what actually
 * holds up - the same `run()`-over-`enterWith()` lesson the real app code
 * (lib/db/current-user.ts) already learned the hard way. */
export function asSignedInUser(sub: string, email: string, fn: () => Promise<void>) {
  return async () => {
    await seedSignedInUser(sub, email);
    const { conn } = await resolveCurrentUser();
    await runWithUserDb(conn, fn);
  };
}
