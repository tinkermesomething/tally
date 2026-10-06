/** One colour per kind of word, so "payee" is the same blue everywhere it
 * appears (rule rows, table headings, labels). They are the chart tokens,
 * which already have light and dark variants. */
export const FIELD_COLOR = {
  payee: "text-chart-1",
  amount: "text-chart-2",
  category: "text-chart-3",
  note: "text-chart-4",
  debt: "text-chart-5",
  date: "text-chart-6",
  account: "text-chart-7",
} as const;

export type FieldKind = keyof typeof FIELD_COLOR;
