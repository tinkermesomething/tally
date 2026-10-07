import { eq } from "drizzle-orm";
import { db } from "./index";
import { appSettings } from "./schema";
import { isDateFormat, type DateFormat } from "../date-format";
import { isCurrencyCode } from "../money";

export type AppSettings = {
  currency: string;
  dateFormat: DateFormat;
  /** The first tracked period for the Left to spend carry-over chain -
   * nothing carries INTO this period, only out of it going forward. Null
   * in the DB resolves to the current year/month here (computed fresh on
   * every read, not frozen to whenever the settings row was created), so
   * carry-over stays effectively off until the user deliberately picks a
   * start point in Settings. */
  carryOverStartYear: number;
  carryOverStartMonth: number;
  bankSyncEnabled: boolean;
  bankSyncFrequencyHours: number;
  /** Pause switch for automatic backups (they also need BACKUP_DIR). */
  autoBackupEnabled: boolean;
};

const DEFAULTS = { currency: "GBP", dateFormat: "dmy" as DateFormat };

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Always reads (and, on first ever call, creates) the single settings row -
 * callers never deal with "no row yet" themselves. dateFormat is validated
 * against the known set on the way out, falling back to the default rather
 * than handing an unrecognized string to formatDate. */
export async function getAppSettings(): Promise<AppSettings> {
  const row = await db.query.appSettings.findFirst();
  const { year: thisYear, month: thisMonth } = currentYearMonth();
  if (row) {
    return {
      currency: row.currency,
      dateFormat: isDateFormat(row.dateFormat) ? row.dateFormat : DEFAULTS.dateFormat,
      carryOverStartYear: row.carryOverStartYear ?? thisYear,
      carryOverStartMonth: row.carryOverStartMonth ?? thisMonth,
      bankSyncEnabled: row.bankSyncEnabled,
      bankSyncFrequencyHours: row.bankSyncFrequencyHours,
      autoBackupEnabled: row.autoBackupEnabled,
    };
  }
  const [created] = await db.insert(appSettings).values({}).returning();
  return {
    currency: created.currency,
    dateFormat: DEFAULTS.dateFormat,
    carryOverStartYear: thisYear,
    carryOverStartMonth: thisMonth,
    bankSyncEnabled: created.bankSyncEnabled,
    bankSyncFrequencyHours: created.bankSyncFrequencyHours,
    autoBackupEnabled: created.autoBackupEnabled,
  };
}

const VALID_SYNC_FREQUENCIES = [6, 12, 24];

export async function updateAppSettings(input: {
  currency?: string;
  dateFormat?: DateFormat;
  carryOverStartYear?: number;
  carryOverStartMonth?: number;
  bankSyncEnabled?: boolean;
  bankSyncFrequencyHours?: number;
  autoBackupEnabled?: boolean;
}) {
  if (input.currency !== undefined && !isCurrencyCode(input.currency)) {
    throw new Error(`Unrecognized currency code: "${input.currency}"`);
  }
  if (input.dateFormat !== undefined && !isDateFormat(input.dateFormat)) {
    throw new Error(`Unrecognized date format: "${input.dateFormat}"`);
  }
  if (input.carryOverStartMonth !== undefined && (input.carryOverStartMonth < 1 || input.carryOverStartMonth > 12)) {
    throw new Error(`carryOverStartMonth must be 1-12, got ${input.carryOverStartMonth}`);
  }
  if (input.bankSyncFrequencyHours !== undefined && !VALID_SYNC_FREQUENCIES.includes(input.bankSyncFrequencyHours)) {
    throw new Error(`bankSyncFrequencyHours must be one of ${VALID_SYNC_FREQUENCIES.join(", ")}, got ${input.bankSyncFrequencyHours}`);
  }
  await getAppSettings(); // ensures the row exists before updating it
  const row = await db.query.appSettings.findFirst();
  await db
    .update(appSettings)
    .set({
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.dateFormat !== undefined ? { dateFormat: input.dateFormat } : {}),
      ...(input.carryOverStartYear !== undefined ? { carryOverStartYear: input.carryOverStartYear } : {}),
      ...(input.carryOverStartMonth !== undefined ? { carryOverStartMonth: input.carryOverStartMonth } : {}),
      ...(input.bankSyncEnabled !== undefined ? { bankSyncEnabled: input.bankSyncEnabled } : {}),
      ...(input.bankSyncFrequencyHours !== undefined ? { bankSyncFrequencyHours: input.bankSyncFrequencyHours } : {}),
      ...(input.autoBackupEnabled !== undefined ? { autoBackupEnabled: input.autoBackupEnabled } : {}),
    })
    .where(eq(appSettings.id, row!.id));
}

/** The saved automatic-backup choices, as JSON (see lib/auto-backup-settings.ts). */
export async function getAutoBackupStored(): Promise<string | null> {
  await getAppSettings(); // makes sure the row exists
  const row = await db.query.appSettings.findFirst();
  return row?.autoBackupConfig ?? null;
}

export async function setAutoBackupStored(json: string | null) {
  await getAppSettings();
  const row = await db.query.appSettings.findFirst();
  await db.update(appSettings).set({ autoBackupConfig: json }).where(eq(appSettings.id, row!.id));
}
