import { auth } from "@/auth";

/** Server actions are public HTTP endpoints, so each one verifies the
 * session itself instead of relying only on middleware.ts (one matcher
 * regression there would otherwise expose every action). */
export async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return session;
}
