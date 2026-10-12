import { redirect } from "next/navigation";
import { Home, Wallet } from "lucide-react";
import { getHouseholdExpenses, getHouseholdIncome, isHouseholdEnabled } from "@/lib/db/household";
import { getAppSettings } from "@/lib/db/settings";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { MONTH_NAMES } from "@/lib/months";
import { StatCard } from "@/components/grid/stat-card";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
import { UserAvatar } from "@/components/settings/user-avatar";
import { GROUP_PALETTE } from "@/lib/group-colors";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function HouseholdPage() {
  return withCurrentUser(async () => {
    // Admin-only feature switch, not a per-user preference - someone who
    // reaches this URL while it's off gets sent back, same as a nav item
    // that was never there to click.
    if (!(await isHouseholdEnabled())) redirect("/grid");

    const [expenses, income, { currency, dateFormat }] = await Promise.all([getHouseholdExpenses(), getHouseholdIncome(), getAppSettings()]);

    const expenseTotalPence = expenses.reduce((sum, e) => sum + e.amountPence, 0);
    const incomeTotalPence = income.reduce((sum, i) => sum + i.amountPence, 0);

    const byCategory = new Map<string, number>();
    for (const e of expenses) byCategory.set(e.categoryName, (byCategory.get(e.categoryName) ?? 0) + e.amountPence);
    const slices: GroupSlice[] = [...byCategory.entries()].map(([group, amountPence], i) => ({
      group,
      amountPence,
      color: GROUP_PALETTE[i % GROUP_PALETTE.length],
      categories: [],
    }));

    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Household</h1>
          <p className="text-sm text-muted-foreground">
            Built from what each person has chosen to share from their own budget - read-only here. Edit on the
            sharing person&apos;s own Entries, Grid or Income page.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatCard label="Shared expenses" value={formatPence(expenseTotalPence, currency)} icon={Wallet} tone="critical" />
          <StatCard label="Shared income" value={formatPence(incomeTotalPence, currency)} icon={Wallet} tone="good" />
        </div>

        {slices.length > 1 && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-1 font-medium">Shared expenses by category</h2>
            <CategoryPieChart slices={slices} compact />
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 font-medium">Shared expenses</h2>
          {expenses.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Home className="size-6" />
              <p>Nothing shared yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 row-card rounded-lg px-2 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar userId={e.sourceUserId} name={e.sourceUserName} email={e.sourceUserEmail} color={e.sourceUserColor} size={22} />
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{e.categoryName}</span>
                      {e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                    <span className="text-xs">{formatDate(e.entryDate, dateFormat)}</span>
                    <span className="tabular-nums text-foreground">{formatPence(e.amountPence, currency)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 font-medium">Shared income</h2>
          {income.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing shared yet.</p>
          ) : (
            <div className="space-y-1.5">
              {income.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 row-card rounded-lg px-2 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar userId={i.sourceUserId} name={i.sourceUserName} email={i.sourceUserEmail} color={null} size={22} />
                    <span className="min-w-0 truncate font-medium">{i.sourceName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                    <span className="text-xs">
                      {MONTH_NAMES[i.month - 1]} {i.year}
                    </span>
                    <span className="tabular-nums text-foreground">{formatPence(i.amountPence, currency)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  });
}
