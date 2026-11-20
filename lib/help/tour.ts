// The first-run tour: what each card says and the rules for walking it. Pure
// (no DOM), so the order and the skipping rules are unit-tested. Words match
// the buttons on screen: Add income, Log expense, Mark paid, Left to spend.
export type TourContext = {
  desktop: boolean;
  /** Narrow screen: the grid is a list of cards, not a table. */
  mobile: boolean;
  /** "Show ? help icons" is on, so "hover the ?" makes sense. */
  helpIcons: boolean;
};

export type TourStep = {
  id: string;
  /** The `data-tour` value of the element to highlight. None = a centred card. */
  anchor?: string;
  title: (c: TourContext) => string;
  body: (c: TourContext) => string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: () => "Welcome to Tally",
    body: () => "A one-minute tour of the parts that matter. Skip any time. You can replay it from Settings.",
  },
  {
    id: "add-income",
    anchor: "add-income",
    title: () => "Add income when you get paid",
    body: () => "Click Add income, pick a source like Salary (or create it right there), and enter the amount.",
  },
  {
    id: "log-expense",
    anchor: "log-expense",
    title: () => "Log expenses as you spend",
    body: () => "Click Log expense, pick a category like Groceries (or create one right there), and enter the amount.",
  },
  {
    id: "summary-pills",
    anchor: "summary-pills",
    title: () => "Left to spend is the number to watch",
    body: (c) =>
      "It is the money you can still spend right now." +
      (c.helpIcons ? " Click the ? next to each number to see what the others mean." : ""),
  },
  {
    id: "grid",
    anchor: "grid",
    title: () => "This is your plan",
    body: (c) =>
      c.mobile
        ? "Each card is a category. Use the arrows to change month. Tap an amount to enter what you plan to spend, and use Mark paid when the money has gone."
        : "Each row is a category and each column a month. Click a cell to enter what you plan to spend, and use Mark paid when the money has gone.",
  },
  {
    id: "review",
    anchor: "nav-review",
    title: (c) => (c.desktop ? "Import your bank's transactions" : "Bank transactions go here"),
    body: (c) =>
      (c.desktop
        ? "Export a CSV from your bank, import it here, and give each transaction a category."
        : "Synced or imported, give each transaction a category here.") + " The grid updates.",
  },
  {
    id: "user-menu",
    anchor: "user-menu",
    title: () => "Settings holds the rest",
    body: () =>
      "Click your avatar, then Settings. There you create categories, set up rules that sort imports for you, choose which pages show, and replay this tour.",
  },
  {
    id: "done",
    title: () => "You're set",
    body: () => "Next: click Add income.",
  },
];

/** The steps to walk: a step whose anchor is not on screen is dropped, never
 * shown pointing at nothing. */
export function stepsToShow(steps: TourStep[], anchorVisible: (anchor: string) => boolean): TourStep[] {
  return steps.filter((s) => !s.anchor || anchorVisible(s.anchor));
}

export type TourMove = { index: number } | { finished: true };

export function nextStep(index: number, count: number): TourMove {
  return index + 1 >= count ? { finished: true } : { index: index + 1 };
}

export function previousStep(index: number): TourMove {
  return { index: Math.max(0, index - 1) };
}
