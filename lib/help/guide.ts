// The Help page (app/help/page.tsx). Longer than a ? tip, but tips are
// reused by id (`{ tip: "grid.budgeted" }`) so a shared sentence still lives
// only in lib/help/content.ts. Every claim here was read from the code.
import type { HelpId } from "@/lib/help/content";

export type Block =
  | { p: string }
  | { steps: string[] }
  | { bullets: string[] }
  | { tip: HelpId }
  | { action: "tour" };

export type Section = {
  /** The anchor: /help#<id>. Tips link here through their `learnMore`. */
  id: string;
  title: string;
  /** Left out, the section shows in both builds. */
  only?: "desktop" | "web";
  blocks: Block[];
};

export const GUIDE: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    blocks: [
      { p: "Tally is a monthly budget. You plan what you will spend, record what you actually spend, and Tally shows what is left." },
      {
        steps: [
          "Click Add income and enter what you receive. You can create a source, like Salary, in the same window.",
          "Click Log expense and enter something you spent. You can create a category, like Groceries, in the same window.",
          "In the grid, click a cell under a month and enter what you plan to spend on that category.",
          "Watch Left to spend at the top of the Budget page. It is the number to watch.",
        ],
      },
      { action: "tour" },
    ],
  },
  {
    id: "numbers",
    title: "The four numbers",
    blocks: [
      { p: "The four pills at the top of the Budget page show this month." },
      { tip: "grid.budgeted" },
      { tip: "grid.income" },
      { tip: "grid.available" },
      { tip: "grid.leftToSpend" },
      { p: "Example: you receive 2,000 this month and budget 1,800. Income is 2,000, Budgeted is 1,800 and Available is 200. After you spend 500, Left to spend is 1,500." },
      { p: "Money left over from last month is added to Left to spend. Choose where that starts in Settings > Account settings > Preferences > Carry-over starts from." },
    ],
  },
  {
    id: "budget",
    title: "The Budget page",
    blocks: [
      {
        bullets: [
          "Each row is a category and each column a month. Year Total and Monthly avg are at the right. On a phone, each category is a card with arrows to change month.",
          "Click a cell to enter what you plan to spend on that category in that month.",
          "Mark paid counts the planned amount as spent. Amounts you record with Log expense count as spent too. The line under a cell, like Paid 23.40, is what was recorded. Click it to see the entries.",
          "A cell can offer last month's amount to fill it in. The button in a month's header fills every blank cell in that month. It never overwrites a number you entered.",
          "Income sources work the same way. The figure is what you expect, and the line under it, Received, is what came in.",
          "The Add category button creates a category. The export button downloads the grid as a CSV file, and the width button stretches the grid to the full page.",
        ],
      },
    ],
  },
  {
    id: "review",
    title: "Review and import",
    blocks: [
      { p: "This page is called Review on the web and Import & review in the desktop app. It is where bank transactions wait to be sorted." },
      { tip: "review.tabs" },
      {
        bullets: [
          "Pick a category (or income source) for a transaction, then click Categorize. The grid updates.",
          "Ignore sets a transaction aside so it isn't counted.",
          "Rule makes a rule from a transaction, so similar ones are sorted for you next time.",
          "Split divides one expense across several categories.",
          "Tag as paying someone back records a transaction as a debt repayment.",
        ],
      },
    ],
  },
  {
    id: "import-csv",
    title: "Import a bank CSV",
    blocks: [
      {
        steps: [
          "Download a CSV file from your bank's website.",
          "Open the Review page (Import & review on desktop) and click Import CSV.",
          "Choose the account, or create a new one, then choose the file.",
          "Check the columns: date, amount and payee. A preview shows exactly what will be imported, and nothing is saved until you press Import.",
          "If some rows look like transactions you already have, choose to import them with a warning or to skip them.",
          "Click Import. The transactions appear under To review.",
        ],
      },
      { tip: "review.importCsv" },
      { tip: "review.duplicates" },
    ],
  },
  {
    id: "rules",
    title: "Rules",
    blocks: [
      { tip: "settings.rules" },
      {
        steps: [
          "Open Settings > Rules and add a rule.",
          "Choose what to match: payee text, an amount, or an account. A rule can have several conditions, and all of them must match.",
          "Choose where matching transactions go.",
        ],
      },
      { p: "You can also start a rule from the Rule button on any transaction in Review." },
    ],
  },
  {
    id: "pay-anchor",
    title: "Pay anchor",
    blocks: [
      { tip: "settings.payAnchor" },
      { p: "Set it in Settings > Income, with the anchor button on an income source." },
    ],
  },
  {
    id: "debts",
    title: "Debts",
    blocks: [
      { p: "Debts keeps a ledger for each person you owe or are owed money by. Their card says You owe or Owed to you." },
      {
        bullets: [
          "Tick \"This is paying someone back (add to Debt)\" when you log an expense. It is recorded in their ledger.",
          "Tick \"This is a loan (add to Debt)\" when you add income. It records money you borrowed.",
        ],
      },
      { tip: "settings.categoryLinks" },
    ],
  },
  {
    id: "savings",
    title: "Savings",
    blocks: [
      { p: "Savings tracks buckets of money you set aside, like kids' savings, a holiday, or a pot at another bank. Each bucket has its own entries, and the top of the page shows the total saved across all buckets." },
    ],
  },
  {
    id: "net-worth",
    title: "Net worth",
    blocks: [
      { p: "Net worth is what you own minus what you owe. It adds your assets and any linked bank balances, then takes off your debts. Assets are things you add by hand, like a car or a pension." },
    ],
  },
  {
    id: "bills",
    title: "Bills",
    blocks: [
      { p: "A category with a due day shows up on the Bills page by itself. Set the due day in Settings > Categories. If next month isn't budgeted yet, Tally carries last month's amount forward and marks it with ~." },
      { p: "The bell in the header lists bills that are overdue or due in the next two weeks." },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    blocks: [
      { p: "Reports shows your budget as charts. Switch between Budgeted (the plan), Spent (what happened), Compare (the two side by side, with the gap) and Trend (over time). Pick a year and month, and export the page as a PDF." },
      { tip: "settings.group" },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    blocks: [
      {
        bullets: [
          "Account settings: your avatar, preferences (currency, date format, language, carry-over start, which header tabs show, help icons), app lock on desktop, and backup and restore.",
          "Categories: rename, regroup, link and archive categories. The Groups tab renames groups and sets their colours.",
          "Income: your income sources and the pay anchor.",
          "Debts: the people you track.",
          "Rules: automatic sorting of imported transactions.",
          "Admin: automatic backups and other settings that cover the whole app.",
        ],
      },
    ],
  },
  {
    id: "backup",
    title: "Back up and restore",
    blocks: [
      { p: "Settings > Account settings > Download my data downloads everything in your account as one file, locked with a password you choose. Keep the password safe: without it, the file cannot be opened." },
      { p: "Restore replaces all of your account's data with a backup file. Tally saves a copy of what is there first, and nothing changes if the password is wrong." },
    ],
  },
  {
    id: "desktop",
    title: "The desktop app",
    only: "desktop",
    blocks: [
      {
        bullets: [
          "Your data lives in a folder on your computer. Data > Show data folder opens it.",
          "Data > Change data folder moves it to an empty folder you choose. Tally copies everything, checks the copy, then switches. Your original is never deleted.",
          "Don't keep the data folder in iCloud, OneDrive or Dropbox. Syncing can corrupt a database.",
          "App lock (Settings > Account settings) asks for a password when Tally opens. It keeps other people at your unlocked computer out. It does not change how your data is encrypted.",
          "The key that opens your data is stored in your computer's keychain. If that entry is lost, the data cannot be opened, so keep a backup with a password.",
          "Tally checks for updates when it opens and asks before installing one.",
        ],
      },
      { tip: "settings.backup" },
    ],
  },
  {
    id: "web",
    title: "Bank sync and sharing",
    only: "web",
    blocks: [
      {
        bullets: [
          "Bank sync (Settings > Bank sync) connects a bank through GoCardless and imports its transactions automatically. A connection expires after a while, and a badge on your avatar warns you when one is close to expiring.",
          "Household, once an admin turns it on, shows the categories that people on the same server chose to share.",
        ],
      },
    ],
  },
];
