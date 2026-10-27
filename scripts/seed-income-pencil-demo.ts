import path from "node:path";
import { eq } from "drizzle-orm";
import { getSystemConn } from "../lib/db/system-connection";
import { users, bankAccounts, incomeSources } from "../lib/db/schema";
import { openUserDb } from "../lib/db/connection";
import { openDek, dekToHex } from "../lib/user-dek";

/**
 * Dev-only: seeds a dummy "pending at the bank" income credit so the
 * income pencil-in feature (v4.9.2) can be clicked through locally without
 * a real GoCardless sync. Writes directly into ALLOWED_EMAIL's own
 * per-user encrypted file, the same way scripts/migrate-to-per-user.ts
 * does - never over HTTP, never touches another account.
 *
 * Run via `npx tsx scripts/seed-income-pencil-demo.ts`. Safe to re-run:
 * reuses an existing demo bank account/income source by name instead of
 * duplicating them, and only ever overwrites pendingPreviewJson (a cache
 * field, not real data) on each run.
 */

function userFileFor(userId: number): string {
  const dir = process.env.USERS_DB_DIR?.trim() || path.join(path.dirname(process.env.DATABASE_PATH ?? "./config/tally.db"), "users");
  return path.join(dir, `${userId}.db`);
}

async function main() {
  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (!allowedEmail) throw new Error("ALLOWED_EMAIL is not set - can't tell which account to seed into.");

  const sys = getSystemConn();
  const me = await sys.db.query.users.findFirst({ where: eq(users.email, allowedEmail) });
  if (!me) throw new Error(`No account for ${allowedEmail} yet - sign in once first.`);
  if (!me.oidcSub || !me.dekSealed) {
    throw new Error(`${allowedEmail}'s account has never completed a real login (no key on file) - sign in first.`);
  }

  const dek = openDek(me.dekSealed, me.oidcSub);
  const { db } = openUserDb(userFileFor(me.id), dekToHex(dek));

  let account = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.displayName, "Demo account (pencil-in test)") });
  if (!account) {
    [account] = await db
      .insert(bankAccounts)
      .values({
        provider: "demo",
        institutionId: "demo",
        requisitionId: "demo",
        externalAccountId: "demo-pencil-in",
        displayName: "Demo account (pencil-in test)",
        consentExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      })
      .returning();
    console.log(`Created bank account #${account.id}.`);
  } else {
    console.log(`Reusing bank account #${account.id}.`);
  }

  let source = await db.query.incomeSources.findFirst({ where: eq(incomeSources.name, "Gifts") });
  if (!source) {
    [source] = await db.insert(incomeSources).values({ name: "Gifts", sortOrder: 99 }).returning();
    console.log(`Created income source #${source.id} ("Gifts").`);
  } else {
    console.log(`Reusing income source #${source.id} ("Gifts").`);
  }

  const today = new Date();
  const pending = [
    // The exact scenario from the bug report: a +£20 credit sitting
    // pending at the bank, previously invisible anywhere in the app.
    { amountPence: 2000, date: today.toISOString().slice(0, 10), payeeRaw: "SURPRISE GIFT" },
    // A second one, same amount/payee, to also exercise the "two
    // identical pending rows, one pencilled, pair one-to-one" case.
    { amountPence: 2000, date: today.toISOString().slice(0, 10), payeeRaw: "SURPRISE GIFT" },
  ];
  await db.update(bankAccounts).set({ pendingPreviewJson: JSON.stringify(pending) }).where(eq(bankAccounts.id, account.id));
  console.log(`Set ${pending.length} dummy pending credits on the demo account.`);
  console.log("\nDone - open /review locally, scroll to \"Pending at the bank\", and pencil one in as Gifts.");
}

main().catch((err) => {
  console.error("[seed-income-pencil-demo] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
