"use client";

import { useState, useTransition } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { ReviewTransactionRow, type ReviewRow } from "@/components/review/review-transaction-row";
import {
  bulkIgnoreImportedTransactions,
  bulkCategorizeImportedTransactionsAsExpense,
  bulkCategorizeImportedTransactionsAsIncome,
} from "@/app/review/actions";

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
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkIncomeSourceId, setBulkIncomeSourceId] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === transactions.length ? new Set() : new Set(transactions.map((t) => t.id))));
  }

  // "Above"/"below" only has one obvious meaning with a single anchor point -
  // once more than one row is selected, above/below whichever one? These are
  // a bulk-catch-up tool (e.g. right after a big import), not something used
  // routinely, so they only appear for a single-item selection rather than
  // trying to define a sensible multi-anchor behavior.
  const singleSelectedId = selected.size === 1 ? Array.from(selected)[0] : null;
  const anchorIndex = singleSelectedId !== null ? transactions.findIndex((t) => t.id === singleSelectedId) : -1;

  function selectAbove() {
    if (anchorIndex < 0) return;
    setSelected(new Set(transactions.slice(0, anchorIndex + 1).map((t) => t.id)));
  }

  function selectBelow() {
    if (anchorIndex < 0) return;
    setSelected(new Set(transactions.slice(anchorIndex).map((t) => t.id)));
  }

  function bulkIgnore() {
    const ids = Array.from(selected);
    startTransition(async () => {
      await bulkIgnoreImportedTransactions(ids);
      setSelected(new Set());
    });
  }

  const selectedTransactions = transactions.filter((t) => selected.has(t.id));
  const allSelectedExpense = selectedTransactions.length > 0 && selectedTransactions.every((t) => t.amountPence < 0);
  const allSelectedIncome = selectedTransactions.length > 0 && selectedTransactions.every((t) => t.amountPence > 0);

  function bulkApprove() {
    const ids = Array.from(selected);
    if (allSelectedExpense && bulkCategoryId) {
      startTransition(async () => {
        await bulkCategorizeImportedTransactionsAsExpense(ids, { categoryId: parseInt(bulkCategoryId, 10) });
        setSelected(new Set());
        setBulkCategoryId("");
      });
    } else if (allSelectedIncome && bulkIncomeSourceId) {
      startTransition(async () => {
        await bulkCategorizeImportedTransactionsAsIncome(ids, { incomeSourceId: parseInt(bulkIncomeSourceId, 10) });
        setSelected(new Set());
        setBulkIncomeSourceId("");
      });
    }
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
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
          <span className="mr-auto">{selected.size} selected</span>
          {anchorIndex >= 0 && (
            <>
              <Button size="sm" variant="outline" onClick={selectAbove}>
                Select all above
              </Button>
              <Button size="sm" variant="outline" onClick={selectBelow}>
                Select all below
              </Button>
            </>
          )}
          {allSelectedExpense && (
            <Select value={bulkCategoryId} onValueChange={(v) => setBulkCategoryId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue>
                  {(value: string) =>
                    value ? (categories.find((c) => String(c.id) === value)?.name ?? value) : "Choose a category"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {allSelectedIncome && (
            <Select value={bulkIncomeSourceId} onValueChange={(v) => setBulkIncomeSourceId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue>
                  {(value: string) =>
                    value ? (incomeSources.find((s) => String(s.id) === value)?.name ?? value) : "Choose a source"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {incomeSources.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(allSelectedExpense || allSelectedIncome) && (
            <Button
              size="sm"
              onClick={bulkApprove}
              disabled={pending || (allSelectedExpense ? !bulkCategoryId : !bulkIncomeSourceId)}
            >
              Approve selected
            </Button>
          )}
          {!allSelectedExpense && !allSelectedIncome && (
            <span className="text-xs text-muted-foreground">Select only money-out or only money-in to bulk-approve</span>
          )}
          <Button size="sm" variant="outline" onClick={bulkIgnore} disabled={pending}>
            Ignore selected
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox
                checked={transactions.length > 0 && selected.size === transactions.length}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Payee</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Category / Source</TableHead>
            <TableHead>Debt</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
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
        </TableBody>
      </Table>
    </div>
  );
}
