// Shared between the expense table, the monthly summary bubble, and the
// income table so their columns always line up exactly and their scroll
// positions can be kept in sync - table-layout: fixed + an explicit
// <colgroup> makes every column's width deterministic (content can never
// renegotiate it).
export const CATEGORY_COL_WIDTH = 168;
export const MONTH_COL_WIDTH = 130;
export const SUMMARY_COL_WIDTH = 132;
export const TABLE_WIDTH =
  CATEGORY_COL_WIDTH + MONTH_COL_WIDTH * 12 + SUMMARY_COL_WIDTH * 2;
