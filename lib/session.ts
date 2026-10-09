/** Server actions are public HTTP endpoints, so each one verifies the
 * session itself instead of relying only on middleware.ts (one matcher
 * regression there would otherwise expose every action).
 *
 * This is `withCurrentUser` (lib/db/current-user.ts) under the name every
 * action already calls it by - the two are the same operation (resolve who
 * this is, run the action's body with their encrypted connection active for
 * every await inside it). Kept as a real re-export, not a separate
 * wrapper, so there's exactly one implementation to reason about. */
export { withCurrentUser as requireSession } from "@/lib/db/current-user";
