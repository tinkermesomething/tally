import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** The OIDC `sub` claim - the real key for resolving which account
       * (and which encrypted database file) this session belongs to. See
       * lib/db/current-user.ts. */
      sub: string;
    } & DefaultSession["user"];
  }
}
