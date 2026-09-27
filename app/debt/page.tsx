import Link from "next/link";
import { Users, Scale } from "lucide-react";
import { getPeopleWithBalances } from "@/lib/db/debt";
import { formatPence } from "@/lib/money";
import { AddPersonDialog } from "@/components/debt/add-person-dialog";
import { StatCard } from "@/components/grid/stat-card";
import { cn } from "@/lib/utils";

// Always reflects live data - never statically prerendered (which would also
// query the database at build time, before any real data/schema exists).
export const dynamic = "force-dynamic";

export default async function DebtPage() {
  const people = await getPeopleWithBalances();
  const netBalancePence = people.reduce((sum, p) => sum + p.balancePence, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Debt</h1>
        <AddPersonDialog />
      </div>

      {people.length > 0 && netBalancePence !== 0 && (
        <StatCard
          label={netBalancePence > 0 ? "Net: you owe" : "Net: owed to you"}
          value={formatPence(Math.abs(netBalancePence))}
          icon={Scale}
          tone={netBalancePence > 0 ? "critical" : "good"}
        />
      )}

      {people.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Users className="size-6" />
          <p>No one tracked yet. Add a person to start a ledger.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((person) => (
            <Link
              key={person.id}
              href={`/debt/${person.id}`}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-sm transition-colors hover:border-primary/40"
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
                    ? `You owe ${formatPence(person.balancePence)}`
                    : `Owed to you ${formatPence(-person.balancePence)}`}
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
}
