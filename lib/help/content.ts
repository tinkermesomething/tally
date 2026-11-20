// The ONE place help copy lives. The "?" tips (components/help-tip.tsx) and,
// later, the Help page both read these entries, so a sentence is edited once.
// Words must match the screen: Budgeted, Income, Available, Left to spend,
// Add income, Log expense, Mark paid.
type HelpEntry = {
  /** What the thing is called on screen. */
  title: string;
  /** One or two sentences. Say what it does, then what to do. */
  tip: string;
};

export const HELP = {
  "grid.budgeted": {
    title: "Budgeted",
    tip: "What you plan to spend this month. You set it in the grid below, and it doesn't change when you pay things.",
  },
  "grid.income": {
    title: "Income",
    tip: "Money that has actually come in this month, not what you expect.",
  },
  "grid.available": {
    title: "Available",
    tip: 'Income minus Budgeted: what would be left if you stick to the plan. "Left to spend" is the live version.',
  },
  "grid.leftToSpend": {
    title: "Left to spend",
    tip: "The money you can still spend right now: your income, minus what you have spent, plus anything left over from last month. An overspend last month is taken off.",
  },
  "settings.categoryLinks": {
    title: "Category links",
    tip: "Use the + next to a category to link it elsewhere. A due day puts it on the Bills page, and a debt link records its expenses as repayments to one person.",
  },
  "settings.group": {
    title: "Groups",
    tip: "Put categories under one group, like Bills or Fun, and Reports can show them together.",
  },
  "settings.payAnchor": {
    title: "Pay anchor",
    tip: "Mark the source that pays you. When you log a payment from it, you pick which budget month it starts, so your budget follows your pay date, not the calendar.",
  },
  "settings.rules": {
    title: "Rules",
    tip: 'Rules sort transactions into categories as they import, for example: payee contains "TESCO" goes to Groceries. The first rule that matches wins.',
  },
  "settings.backup": {
    title: "Backups",
    tip: "Automatic backups need a password so they are encrypted. Without one, Tally makes no automatic backups.",
  },
  "review.tabs": {
    title: "To review and Logged",
    tip: "To review: transactions waiting for a category. Logged: everything already recorded.",
  },
  "review.importCsv": {
    title: "Import CSV",
    tip: "Import your bank's CSV export. You pick the columns and see a preview first, and transactions you already imported are skipped.",
  },
  "review.duplicates": {
    title: "Possible duplicates",
    tip: "A possible duplicate looks like a transaction you already have. Import it with a warning triangle in To review, or skip it.",
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpId = keyof typeof HELP;
