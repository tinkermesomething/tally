export const DATE_FORMATS = ["dmy", "mdy", "ymd"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dmy: "DD/MM/YYYY",
  mdy: "MM/DD/YYYY",
  ymd: "YYYY-MM-DD",
};

export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === "string" && (DATE_FORMATS as readonly string[]).includes(value);
}

/** Renders a strict "YYYY-MM-DD" date string (see lib/date.ts's parseIsoDate
 * - the same format every entryDate in this app is stored in) in the
 * user's chosen display format. Only for READ-ONLY display - native
 * `<input type="date">` fields always take/show "YYYY-MM-DD" regardless of
 * this setting, since that's the HTML spec's own wire format for the
 * control, not something this app renders itself. */
export function formatDate(isoDate: string, format: DateFormat): string {
  const [y, m, d] = isoDate.split("-");
  switch (format) {
    case "mdy":
      return `${m}/${d}/${y}`;
    case "ymd":
      return `${y}-${m}-${d}`;
    case "dmy":
    default:
      return `${d}/${m}/${y}`;
  }
}
