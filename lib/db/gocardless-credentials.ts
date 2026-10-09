import { eq } from "drizzle-orm";
import { db } from "./index";
import { gocardlessCredentials } from "./schema";

/** This user's own GoCardless API credentials - see the schema's own
 * comment for why these moved out of a shared env var. Uses the ambient
 * per-request `db` like the rest of this app's query layer (lib/db/*.ts),
 * never a passed-in connection - whichever user's context is active when
 * this is called is the only account it can ever read or write. */
export type GocardlessCredentials = { secretId: string; secretKey: string };

export async function getGocardlessCredentials(): Promise<GocardlessCredentials | null> {
  const row = await db.query.gocardlessCredentials.findFirst();
  return row ? { secretId: row.secretId, secretKey: row.secretKey } : null;
}

/** Whether credentials are set, without handing the secret key back out -
 * what the settings UI shows ("configured" vs a form to add them), never
 * the real value once saved. */
export async function hasGocardlessCredentials(): Promise<boolean> {
  return (await db.query.gocardlessCredentials.findFirst()) !== undefined;
}

export async function setGocardlessCredentials(secretId: string, secretKey: string) {
  const existing = await db.query.gocardlessCredentials.findFirst();
  if (existing) {
    await db.update(gocardlessCredentials).set({ secretId, secretKey }).where(eq(gocardlessCredentials.id, existing.id));
  } else {
    await db.insert(gocardlessCredentials).values({ secretId, secretKey });
  }
}

export async function clearGocardlessCredentials() {
  await db.delete(gocardlessCredentials);
}
