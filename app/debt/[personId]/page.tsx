import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPersonLedger } from "@/lib/db/debt";
import { getCategoryTree, getIncomeSourceList } from "@/lib/db/queries";
import { formatPence } from "@/lib/money";
import { AddEntryDialog } from "@/components/debt/add-entry-dialog";
import { cn } from "@/lib/utils";

export default async function PersonLedgerPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const id = parseInt(personId, 10);
  const [{ person, entries, balancePence }, incomeSources, categoryTree] = await Promise.all([
    getPersonLedger(id),
    getIncomeSourceList(),
    getCategoryTree(),
  ]);

  if (!person) notFound();

  const categories = categoryTree.flatMap((c) => [
    { id: c.id, name: c.name },
    ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
  ]);

  const newestFirst = [...entries].reverse();

  return (
    <div className="space-y-4">
      <Link
        href="/debt"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Debt
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{person.name}</h1>
          {balancePence === 0 ? (
            <p className="text-muted-foreground">All settled up</p>
          ) : (
            <p
              className={cn(
                "text-2xl font-semibold tabular-nums",
                balancePence > 0 ? "text-status-critical" : "text-status-good"
              )}
            >
              {balancePence > 0
                ? `You owe ${formatPence(balancePence)}`
                : `Owed to you ${formatPence(-balancePence)}`}
            </p>
          )}
        </div>
        <AddEntryDialog
          personId={person.id}
          personName={person.name}
          incomeSources={incomeSources}
          categories={categories}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No entries yet.
                </td>
              </tr>
            ) : (
              newestFirst.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{entry.entryDate}</td>
                  <td className="px-3 py-2">
                    {entry.direction === "loan" ? "Borrowed" : "Paid back"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.note ?? "—"}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      entry.direction === "loan" ? "text-status-critical" : "text-status-good"
                    )}
                  >
                    {entry.direction === "loan" ? "+" : "−"}
                    {formatPence(entry.amountPence)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatPence(entry.runningBalancePence)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
