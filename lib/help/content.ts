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
} as const satisfies Record<string, HelpEntry>;

export type HelpId = keyof typeof HELP;
