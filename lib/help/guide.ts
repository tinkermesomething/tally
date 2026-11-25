// The Help page (app/help/page.tsx). Longer than a ? tip, but tips are
// reused by id (`{ tip: "grid.budgeted" }`) so a shared sentence still lives
// only in lib/help/content.ts. Every claim here was read from the code.
import type { HelpId } from "@/lib/help/content";

export type Block =
  | { p: string }
  | { steps: string[] }
  | { bullets: string[] }
  /** Monospace, for a folder layout or a path. */
  | { code: string }
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
          "Open the Review page (Import & review on desktop) and click Import CSV. On the web app the button is under the To review tab.",
          "Choose the account, or create a new one, then choose the file.",
          "Check the columns: date, amount and payee. A preview shows exactly what will be imported, and nothing is saved until you press Import.",
          "If some rows look like transactions you already have, choose to import them with a warning or to skip them.",
          "Click Import. The transactions appear under To review.",
        ],
      },
      { tip: "review.importCsv" },
      { tip: "review.duplicates" },
      {
        bullets: [
          "Tally reads UTF-8, Windows-1252 (older UK and EU exports) and Excel's Unicode text. Commas, semicolons, tabs and pipes all work.",
          "A title or account summary above the table is skipped for you. Check the Lines to skip box if the preview looks wrong.",
          "If your bank puts fees in their own column (Revolut does), pick it under Fee column. The fee is taken off the amount.",
          "Some files show spending as positive numbers (credit cards often do). Tally looks at lines like PAYMENT RECEIVED and salary to work out which way round the file is, and tells you what it chose. If it can't tell, it asks you before you can import. Always check the preview: + is money in, − is money out.",
          "If your file has a Status or State column, Tally leaves out lines that are pending, reverted, declined, failed or cancelled. Pending payments come in on a later file, once the bank has settled them.",
          "Dates like 03/04/2026 can be read two ways. When the file can't tell, Tally follows your Date format setting and says so.",
          "Tally remembers the columns for each account. If your bank later changes its file layout, Tally notices, shows you the columns again and asks you to check them.",
        ],
      },
    ],
  },
  {
    id: "ingest",
    title: "Drop a CSV into a folder",
    blocks: [
      { p: "Instead of importing each bank file by hand, you can drop it into a folder. Tally picks it up and imports it for you." },
      {
        steps: [
          "Desktop app only: open Settings > Account settings > Ingest folder and click Create folder and switch on. Tally suggests a folder called Tally ingest in your home folder. You can type another full path.",
          "In your ingest folder, make a subfolder named after the account, for example Revolut. The ingest folder is the parent, not the account's folder.",
          "Drop the bank's CSV file into that subfolder.",
          "The first file for an account waits. In Settings > Account settings > Ingest folder, click Set up (or Create and set up, if the account doesn't exist yet). Tally opens the file with the account name filled in from the folder. Check the columns and click Import. Do this once per account.",
          "Wait for the next check, or click Check now in Settings > Account settings > Ingest folder.",
          "The new transactions appear under To review, the same as any import.",
        ],
      },
      { p: "The subfolder name picks the account. This is how the folders look:" },
      {
        code: [
          "ingest folder/",
          "  Monzo/               <- the account called Monzo",
          "    october.csv        <- drop files here",
          "  Amex/                <- the account called Amex",
          "    statement.csv",
          "  processed/           <- Tally moves imported files here",
          "  failed/              <- and files it could not read, with a .txt note",
        ].join("\n"),
      },
      { tip: "settings.ingest" },
      {
        bullets: [
          "Tally never guesses the account from the file. Only the subfolder name counts. Capital letters and extra spaces don't matter: monzo and Monzo are the same account. If you gave the account a nickname (an alias), use the nickname.",
          "A file in the wrong place is left alone and is not imported. That means: a CSV dropped straight into the ingest folder, a subfolder with no matching account yet, or an account whose columns you have not confirmed. Settings shows each one as waiting, with the reason and a Set up button.",
          "Imported files move to processed/. Files Tally can't read move to failed/, with a .txt note next to each that says why. Tally never deletes a file.",
          "A file is all or nothing. If one line can't be read, nothing is imported from that file. Lines with an amount of zero are the only exception: they are skipped and counted.",
          "Tally checks that a file looks like the last one you imported by hand for that account. If the bank has moved or renamed the columns Tally reads, the file goes to failed/ with a note saying which column changed. Click Set up, or import it by hand once. Tally then learns the new layout.",
          "Dropping the same file twice is safe. Transactions that already exist are skipped.",
          "Rows that look like a transaction you already have are imported and marked with a warning in To review, the same as a manual import.",
          "Only .csv files are read, and only one level down (ingest folder/account/file.csv). Files up to 10 MB.",
        ],
      },
    ],
  },
  {
    id: "ingest-desktop",
    title: "Ingest folder: desktop setup",
    only: "desktop",
    blocks: [
      {
        bullets: [
          "Choose the folder in Settings > Account settings > Ingest folder and switch it on. Pick any folder you like, and keep it out of iCloud, OneDrive and Dropbox.",
          "Tally checks once, a few seconds after the app opens. It does not watch the folder while the app is open. Click Check now to check at any time.",
        ],
      },
    ],
  },
  {
    id: "ingest-web",
    title: "Ingest folder: server setup",
    only: "web",
    blocks: [
      {
        steps: [
          "The administrator maps one folder into the container, and sets INGEST_DIR to its path inside the container. docker-compose.yml has an example line: ./ingest:/app/ingest.",
          "The administrator makes one subfolder per user, named with that user's email address in lowercase. Tally never creates these folders itself.",
          "Each user then makes account subfolders inside their own folder, as described above.",
        ],
      },
      {
        code: [
          "ingest/",
          "  ann@example.com/     <- Ann's folder, made by the administrator",
          "    Monzo/             <- Ann's account called Monzo",
          "      october.csv",
          "  bob@example.com/     <- Bob's folder",
          "    Amex/",
        ].join("\n"),
      },
      {
        bullets: [
          "You can't choose the folder yourself. If you could, one user could point at another user's folder and import their files.",
          "Tally checks every 15 minutes. Check now does it straight away.",
          "The Tally container needs permission to write in the folders, because it moves files into processed/ and failed/.",
        ],
      },
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
