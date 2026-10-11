import Link from "next/link";
import { Users, Scale } from "lucide-react";
import { getPeopleWithBalances } from "@/lib/db/debt";
import { getAppSettings } from "@/lib/db/settings";
import { formatPence } from "@/lib/money";
import { AddPersonDialog } from "@/components/debt/add-person-dialog";
import { StatCard } from "@/components/grid/stat-card";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
import { GROUP_PALETTE } from "@/lib/group-colors";
import { cn } from "@/lib/utils";
import { withCurrentUser } from "@/lib/db/current-user";

// Always reflects live data - never statically prerendered (which would also
// query the database at build time, before any real data/schema exists).
export const dynamic = "force-dynamic";

export default async function DebtPage() {
  return withCurrentUser(async () => {
  const [people, { currency }] = await Promise.all([getPeopleWithBalances(), getAppSettings()]);
  const netBalancePence = people.reduce((sum, p) => sum + p.balancePence, 0);
  // High-level only: size of each balance, not direction - someone you owe
  // and someone who owes you can both show up as similarly-sized slices.
  // The StatCard above already states the net figure; this is "where does
  // the debt sit", not "am I up or down overall".
  const debtSlices: GroupSlice[] = people
    .filter((p) => p.balancePence !== 0)
    .map((p, i) => ({
      group: p.name,
      amountPence: Math.abs(p.balancePence),
      color: p.color ?? GROUP_PALETTE[i % GROUP_PALETTE.length],
      categories: [],
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Debt</h1>
        <AddPersonDialog />
      </div>

      {people.length > 0 && netBalancePence !== 0 && (
        <StatCard
          label={netBalancePence > 0 ? "Net: you owe" : "Net: owed to you"}
          value={formatPence(Math.abs(netBalancePence), currency)}
          icon={Scale}
          tone={netBalancePence > 0 ? "critical" : "good"}
        />
      )}

      {debtSlices.length > 1 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-1 font-medium">Where the balance sits</h2>
          <p className="mb-2 text-xs text-muted-foreground">Size of each balance, not direction.</p>
          <CategoryPieChart slices={debtSlices} compact />
        </div>
      )}

      {people.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Users className="size-6" />
          <p>Nobody tracked yet. Add one to start a ledger.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((person) => (
            <Link
              key={person.id}
              href={`/debt/${person.id}`}
              className="flex flex-col gap-2 row-card rounded-2xl bg-card px-4 py-3.5 shadow-sm"
            >
              <span className="font-medium">{person.name}</span>
              {person.balancePence === 0 ? (
                <span className="text-sm text-muted-foreground">All settled up</span>
              ) : (
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    person.balancePence > 0 ? "text-status-critical" : "text-status-good"
                  )}
                >
                  {person.balancePence > 0
                    ? `You owe ${formatPence(person.balancePence, currency)}`
                    : `Owed to you ${formatPence(-person.balancePence, currency)}`}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {person.entryCount} {person.entryCount === 1 ? "entry" : "entries"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
  });
}
