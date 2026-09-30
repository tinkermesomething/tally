import { eq } from "drizzle-orm";
import { db } from "./index";
import { appSettings } from "./schema";
import { isDateFormat, type DateFormat } from "../date-format";
import { isCurrencyCode } from "../money";

export type AppSettings = { currency: string; dateFormat: DateFormat };

const DEFAULTS: AppSettings = { currency: "GBP", dateFormat: "dmy" };

/** Always reads (and, on first ever call, creates) the single settings row -
 * callers never deal with "no row yet" themselves. dateFormat is validated
 * against the known set on the way out, falling back to the default rather
 * than handing an unrecognized string to formatDate. */
export async function getAppSettings(): Promise<AppSettings> {
  const row = await db.query.appSettings.findFirst();
  if (row) {
    return {
      currency: row.currency,
      dateFormat: isDateFormat(row.dateFormat) ? row.dateFormat : DEFAULTS.dateFormat,
    };
  }
  const [created] = await db.insert(appSettings).values({}).returning();
  return { currency: created.currency, dateFormat: DEFAULTS.dateFormat };
}

export async function updateAppSettings(input: { currency?: string; dateFormat?: DateFormat }) {
  if (input.currency !== undefined && !isCurrencyCode(input.currency)) {
    throw new Error(`Unrecognized currency code: "${input.currency}"`);
  }
  if (input.dateFormat !== undefined && !isDateFormat(input.dateFormat)) {
    throw new Error(`Unrecognized date format: "${input.dateFormat}"`);
  }
  await getAppSettings(); // ensures the row exists before updating it
  const row = await db.query.appSettings.findFirst();
  await db
    .update(appSettings)
    .set({
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.dateFormat !== undefined ? { dateFormat: input.dateFormat } : {}),
    })
    .where(eq(appSettings.id, row!.id));
}
