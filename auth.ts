import NextAuth from "next-auth";
import authConfig from "./auth.config";
import { checkProfile } from "@/lib/auth-rules";

const allowedEmail = process.env.ALLOWED_EMAIL;
// Which OIDC "groups" claim value counts as admin - "admin" unless the
// self-hoster's own IdP already has a group by that name used for
// something else, in which case they can point this at their own.
const adminGroup = process.env.OIDC_ADMIN_GROUP || undefined;

// Dynamic, not a top-level import: even though the database-touching
// `signIn` callback below now lives only in THIS file (never in
// auth.config.ts, which is all middleware.ts can reach - see that file's
// top comment), keeping this import dynamic costs nothing and is one more
// layer against ever accidentally making this file importable from an Edge
// entry point again. No connection to establish first - lib/audit.ts writes
// straight to the always-open system keystore, not the ambient per-request
// db, which is exactly why it works here before any account is known.
async function audit(action: string, detail?: string) {
  const { audit: write } = await import("@/lib/audit");
  await write(action, detail);
}

/** The full Auth.js instance - used everywhere except middleware.ts (which
 * builds its own lightweight instance straight from auth.config.ts, with
 * no database access at all). See auth.config.ts's top comment for why
 * this split exists. */
export const { handlers, auth, signIn, signOut } = NextAuth((req) => {
  const base = authConfig(req);
  return {
    ...base,
    callbacks: {
      ...base.callbacks,
      // Multi-user: WHICH account (if any) this identity may sign into is
      // resolved by lib/db/users.ts's resolveAndApplySignIn (pure decision
      // in lib/accounts-rules.ts, DB wiring there) - this callback only
      // applies the result and audits it. checkProfile runs first and is
      // deliberately upstream of any account lookup: a missing `sub` or an
      // unverified email are problems with the IDENTITY, not a decision
      // about which account it maps to.
      async signIn({ profile }) {
        const check = checkProfile(profile);
        if (!check.ok) {
          await audit("sign_in_rejected", check.auditDetail);
          return false;
        }
        const { resolveAndApplySignIn } = await import("@/lib/db/users");
        const { resolution } = await resolveAndApplySignIn(
          profile?.email ?? undefined,
          profile!.sub!,
          profile?.name ?? undefined,
          allowedEmail,
          // The OIDC provider's "groups" claim (see auth.config.ts's
          // "groups" scope) - lib/accounts-rules.ts's hasAdminGroup checks
          // its shape, this callback never assumes it.
          (profile as { groups?: unknown } | undefined)?.groups,
          adminGroup
        );
        await audit(resolution.allow ? "sign_in" : "sign_in_rejected", resolution.auditDetail);
        return resolution.allow;
      },
    },
  };
});
