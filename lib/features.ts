import { isDesktopMode } from "@/lib/desktop/mode";

/** What this build offers. Call sites ask for the capability, not the build
 * ("no bank sync here"), so the rule has one home and the call site reads as
 * what it actually needs. isDesktopMode() stays for the real mode switches:
 * auth, the request gate, and the one local user. */
export const features = {
  /** GoCardless bank connections and the scheduled sync. Desktop imports CSV only. */
  get bankSync() {
    return !isDesktopMode();
  },
  /** Several accounts: sign-in/out, user admin, the household budget. Desktop is one local user. */
  get multiUser() {
    return !isDesktopMode();
  },
};
