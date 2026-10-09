import { eq } from "drizzle-orm";
import { getSystemConn } from "./system-connection";
import { gocardlessCredentials } from "./schema";

/** One GoCardless API credential pair for the whole instance - it's a
 * single developer/sandbox registration with GoCardless, not something
 * that varies per account, so it lives in the shared keystore connection
 * (lib/db/system-connection.ts, same place as `users`), never the ambient
 * per-request `db` - an invited user's own empty encrypted file would
 * otherwise have no credentials to find at all. Admin-gated at the action
 * layer (app/settings/bank-sync-actions.ts), not here. */
const sysDb = () => getSystemConn().db;

export type GocardlessCredentials = { secretId: string; secretKey: string };

export async function getGocardlessCredentials(): Promise<GocardlessCredentials | null> {
  const row = await sysDb().query.gocardlessCredentials.findFirst();
  return row ? { secretId: row.secretId, secretKey: row.secretKey } : null;
}

/** Whether credentials are set, without handing the secret key back out -
 * what the settings UI shows ("configured" vs a form to add them), never
 * the real value once saved. */
export async function hasGocardlessCredentials(): Promise<boolean> {
  return (await sysDb().query.gocardlessCredentials.findFirst()) !== undefined;
}

export async function setGocardlessCredentials(secretId: string, secretKey: string) {
  const existing = await sysDb().query.gocardlessCredentials.findFirst();
  if (existing) {
    await sysDb().update(gocardlessCredentials).set({ secretId, secretKey }).where(eq(gocardlessCredentials.id, existing.id));
  } else {
    await sysDb().insert(gocardlessCredentials).values({ secretId, secretKey });
  }
}

export async function clearGocardlessCredentials() {
  await sysDb().delete(gocardlessCredentials);
}
