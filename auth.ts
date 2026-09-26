import NextAuth from "next-auth";

const allowedEmail = process.env.ALLOWED_EMAIL;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "pocket-id",
      name: "Pocket ID",
      type: "oidc",
      issuer: process.env.OIDC_ISSUER,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      // Auth.js's default checks for a generic "oidc" provider omit the
      // OAuth `state` param (relying on PKCE alone for CSRF protection,
      // which is spec-legal). pocket-id's OAuth2 library (ory/fosite)
      // hard-requires `state` regardless - every authorize request came
      // back "invalid_state" until this was added, confirmed by reading
      // fosite's own source (authorize_request_handler.go: rejects any
      // request where len(state) is below its minimum entropy, and an
      // absent state has length 0).
      checks: ["pkce", "state"],
    },
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // This is a single-user app - reject anyone whose pocket-id account isn't
    // the one explicit allowed address, even if pocket-id is later reconfigured
    // with a second account.
    signIn({ profile }) {
      if (!allowedEmail) return true; // no allow-list configured (local dev)
      return profile?.email === allowedEmail;
    },
    authorized({ request, auth }) {
      // Belt-and-suspenders: middleware.ts's matcher is meant to keep this
      // callback from ever running on /api/auth/* in the first place, but
      // Turbopack's build has been observed to compile that matcher down to
      // a catch-all (see middleware.ts) - without this check, a broken
      // matcher makes NextAuth's own csrf/callback endpoints unreachable
      // (this callback returning false redirects them to the sign-in page,
      // which can never get a session to redirect from), breaking login
      // entirely rather than just weakening the gate.
      if (request.nextUrl.pathname.startsWith("/api")) return true;
      return !!auth;
    },
  },
});
