"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { RuleDialog, type RuleContext } from "@/components/review/rule-dialog";
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
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [ruleContext, setRuleContext] = useState<RuleContext | null>(null);
  const openCounter = useRef(0);

  const openRule = useCallback((context: Omit<RuleContext, "openId">) => {
    setRuleContext({ ...context, openId: ++openCounter.current });
  }, []);

  // The list is refreshed only AFTER the window is closed: saving a rule
  // categorizes rows, and redrawing thousands of them while the window is
  // still up froze it on "Done".
  function closeRule(applied: boolean) {
    setRuleContext(null);
    if (applied) startRefresh(() => router.refresh());
  }

  // Rows that left the list (categorized by a rule, ignored elsewhere) must
  // not stay selected - a later bulk action would be fed ids that are no
  // longer pending.
  useEffect(() => {
    const ids = new Set(transactions.map((t) => t.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [transactions]);

  // A provisional match (pencilled-in draft awaiting Confirm/Discard) needs
  // individual attention - bulk-ignoring or bulk-approving it alongside
  // other rows would skip that resolution and leave the draft orphaned.
  const isBulkEligible = (t: ReviewRow) => !t.duplicateOf?.provisional;
  const eligibleTransactions = transactions.filter(isBulkEligible);

  function toggle(id: number) {
    const transaction = transactions.find((t) => t.id === id);
    if (!transaction || !isBulkEligible(transaction)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === eligibleTransactions.length ? new Set() : new Set(eligibleTransactions.map((t) => t.id))
    );
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
    setSelected(new Set(transactions.slice(0, anchorIndex + 1).filter(isBulkEligible).map((t) => t.id)));
  }

  function selectBelow() {
    if (anchorIndex < 0) return;
    setSelected(new Set(transactions.slice(anchorIndex).filter(isBulkEligible).map((t) => t.id)));
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
                checked={eligibleTransactions.length > 0 && selected.size === eligibleTransactions.length}
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
              onOpenRule={openRule}
            />
          ))}
        </TableBody>
      </Table>
      <RuleDialog
        context={ruleContext}
        onClose={closeRule}
        categories={categories}
        incomeSources={incomeSources}
        people={people}
      />
    </div>
  );
}
