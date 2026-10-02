import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DATABASE_PATH = process.env.DATABASE_PATH ?? "./config/tally.db";

const sqlite = new Database(DATABASE_PATH);
sqlite.pragma("journal_mode = WAL");
// WAL + NORMAL never corrupts the database and survives an app crash; the
// only thing it can lose is the last moments of writes if the whole machine
// loses power. The default (FULL) fsyncs on EVERY commit, which on the
// Pi's SD card measured ~11ms per write vs ~0.1ms - applying a rule to
// ~100 rows (about 3 writes each) took seconds instead of a blink.
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
