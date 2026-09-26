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
    authorized({ auth }) {
      return !!auth;
    },
  },
});
