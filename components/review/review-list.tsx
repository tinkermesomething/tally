"use client";

import { useState, useTransition } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReviewTransactionRow, type ReviewRow } from "@/components/review/review-transaction-row";
import { bulkIgnoreImportedTransactions } from "@/app/review/actions";

export function ReviewList({
  transactions,
  categories,
  incomeSources,
  people,
}: {
  transactions: ReviewRow[];
  categories: { id: number; name: string }[];
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkIgnore() {
    const ids = Array.from(selected);
    startTransition(async () => {
      await bulkIgnoreImportedTransactions(ids);
      setSelected(new Set());
    });
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
        <Inbox className="size-6" />
        <p>Nothing waiting for review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={bulkIgnore} disabled={pending}>
            Ignore selected
          </Button>
        </div>
      )}
      {transactions.map((t) => (
        <ReviewTransactionRow
          key={t.id}
          transaction={t}
          categories={categories}
          incomeSources={incomeSources}
          people={people}
          selected={selected.has(t.id)}
          onToggleSelected={toggle}
        />
      ))}
    </div>
  );
}
