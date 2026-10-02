"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { DebtTagControl } from "@/components/review/debt-tag-control";
import { NEW_PERSON, usePersonSelection } from "@/components/grid/person-picker";
import { findLoansSourceId } from "@/lib/loans";
import { amountText, fuzzyScore } from "@/lib/fuzzy";
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
  accounts = [],
}: {
  transactions: ReviewRow[];
  accounts?: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkIncomeSourceId, setBulkIncomeSourceId] = useState("");
  const [bulkTagDebt, setBulkTagDebt] = useState(false);
  const bulkPerson = usePersonSelection();
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [ruleContext, setRuleContext] = useState<RuleContext | null>(null);
  const openCounter = useRef(0);
  // Which rows have a category/source chosen, and each row's own approve
  // action - "Approve selected" with no bulk category approves every ticked
  // row with its own pick.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const approvers = useRef(new Map<number, () => Promise<string | null>>());

  const onPick = useCallback((id: number, isPicked: boolean) => {
    setPicked((prev) => {
      if (prev.has(id) === isPicked) return prev;
      const next = new Set(prev);
      if (isPicked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const onRegisterApprove = useCallback((id: number, fn: (() => Promise<string | null>) | null) => {
    if (fn) approvers.current.set(id, fn);
    else approvers.current.delete(id);
  }, []);

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

  // Filter: every row stays mounted (a category already picked on a row must
  // survive being filtered out), hidden ones just aren't shown. Best matches
  // first while searching; with no search the original order is untouched.
  const { ordered, scores } = useMemo(() => {
    const sc = new Map<number, number>();
    for (const t of transactions) {
      const inAccount = accountFilter === "all" || String(t.accountId) === accountFilter;
      sc.set(
        t.id,
        inAccount
          ? fuzzyScore(query, [t.payeeRaw, t.payeeClean, amountText(t.amountPence), t.accountName, t.bookingDate])
          : 0
      );
    }
    const sorted = transactions
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (sc.get(b.t.id)! > 0 ? 1 : 0) - (sc.get(a.t.id)! > 0 ? 1 : 0) || sc.get(b.t.id)! - sc.get(a.t.id)! || a.i - b.i)
      .map((x) => x.t);
    return { ordered: sorted, scores: sc };
  }, [transactions, query, accountFilter]);
  const visibleTransactions = ordered.filter((t) => scores.get(t.id)! > 0);
  const filtering = query.trim() !== "" || accountFilter !== "all";
  const eligibleTransactions = visibleTransactions.filter(isBulkEligible);

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

  // Select-only (idempotent) - used when a row's category is picked, which
  // must never untick a row that is already selected.
  function select(id: number) {
    const transaction = transactions.find((t) => t.id === id);
    if (!transaction || !isBulkEligible(transaction)) return;
    setSelected((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  // Acts on the rows you can see; ticked rows hidden by the filter keep
  // their tick.
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (eligibleTransactions.every((t) => prev.has(t.id))) eligibleTransactions.forEach((t) => next.delete(t.id));
      else eligibleTransactions.forEach((t) => next.add(t.id));
      return next;
    });
  }

  function dropSelected(ids: number[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // "Above"/"below" only has one obvious meaning with a single anchor point -
  // once more than one row is selected, above/below whichever one? These are
  // a bulk-catch-up tool (e.g. right after a big import), not something used
  // routinely, so they only appear for a single-item selection rather than
  // trying to define a sensible multi-anchor behavior.
  const selectedTransactions = visibleTransactions.filter((t) => selected.has(t.id));
  const hiddenSelected = selected.size - selectedTransactions.length;
  const singleSelectedId = selectedTransactions.length === 1 ? selectedTransactions[0].id : null;
  const anchorIndex = singleSelectedId !== null ? visibleTransactions.findIndex((t) => t.id === singleSelectedId) : -1;

  const keepHidden = () => [...selected].filter((id) => scores.get(id) === 0);
  function selectAbove() {
    if (anchorIndex < 0) return;
    setSelected(new Set([...keepHidden(), ...visibleTransactions.slice(0, anchorIndex + 1).filter(isBulkEligible).map((t) => t.id)]));
  }

  function selectBelow() {
    if (anchorIndex < 0) return;
    setSelected(new Set([...keepHidden(), ...visibleTransactions.slice(anchorIndex).filter(isBulkEligible).map((t) => t.id)]));
  }

  function bulkIgnore() {
    const ids = selectedTransactions.map((t) => t.id);
    startTransition(async () => {
      await bulkIgnoreImportedTransactions(ids);
      dropSelected(ids);
    });
  }

  const allSelectedExpense = selectedTransactions.length > 0 && selectedTransactions.every((t) => t.amountPence < 0);
  const allSelectedIncome = selectedTransactions.length > 0 && selectedTransactions.every((t) => t.amountPence > 0);

  function handleBulkTagChange(next: boolean) {
    setBulkTagDebt(next);
    setBulkError(null);
    // Same suggestion as on a single row: a loan defaults to the loans
    // income source, only when none is chosen yet.
    if (next && allSelectedIncome && !bulkIncomeSourceId) {
      const loansId = findLoansSourceId(incomeSources);
      if (loansId) setBulkIncomeSourceId(loansId);
    }
  }

  const bulkValue = allSelectedExpense ? bulkCategoryId : allSelectedIncome ? bulkIncomeSourceId : "";
  const allSelectedPicked = selectedTransactions.length > 0 && selectedTransactions.every((t) => picked.has(t.id));

  // No bulk category chosen: each ticked row is approved with its own pick.
  function approveEachOwn() {
    const jobs = selectedTransactions
      .map((t) => approvers.current.get(t.id))
      .filter((fn): fn is () => Promise<string | null> => !!fn);
    setBulkError(null);
    startTransition(async () => {
      let failed = 0;
      for (const job of jobs) {
        if (await job()) failed++;
      }
      if (failed > 0) setBulkError(`${failed} not approved - see the message on the row.`);
    });
  }

  function bulkApprove() {
    if (!bulkValue) return approveEachOwn();
    const ids = selectedTransactions.map((t) => t.id);
    if (bulkTagDebt && !bulkPerson.personId) {
      setBulkError(allSelectedIncome ? "Pick who you borrowed this from, or turn off the loan tag." : "Pick who this repayment is to, or turn off the debt tag.");
      return;
    }
    if (bulkTagDebt && bulkPerson.personId === NEW_PERSON && !bulkPerson.newPersonName.trim()) {
      setBulkError("Enter the new person's name.");
      return;
    }
    setBulkError(null);
    startTransition(async () => {
      try {
        const debtPersonId = bulkTagDebt ? await bulkPerson.resolvePersonId() : undefined;
        if (allSelectedExpense) {
          await bulkCategorizeImportedTransactionsAsExpense(ids, { categoryId: parseInt(bulkCategoryId, 10), debtPersonId });
          setBulkCategoryId("");
        } else {
          await bulkCategorizeImportedTransactionsAsIncome(ids, { incomeSourceId: parseInt(bulkIncomeSourceId, 10), debtPersonId });
          setBulkIncomeSourceId("");
        }
        dropSelected(ids);
        setBulkTagDebt(false);
        bulkPerson.reset();
      } catch (err) {
        setBulkError(err instanceof Error ? err.message : "Failed to approve.");
      }
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search payee, amount, date…"
          aria-label="Search transactions"
          className="w-64"
        />
        {accounts.length > 1 && (
          <Select value={accountFilter} onValueChange={(v) => setAccountFilter(v ?? "all")}>
            <SelectTrigger className="w-52" aria-label="Filter by account">
              <SelectValue>
                {(v: string) => (v === "all" ? "All accounts" : (accounts.find((a) => String(a.id) === v)?.name ?? v))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filtering && (
          <>
            <span className="text-xs text-muted-foreground" data-testid="filter-count">
              Showing {visibleTransactions.length} of {transactions.length}
            </span>
            <Button size="xs" variant="ghost" onClick={() => { setQuery(""); setAccountFilter("all"); }}>
              Clear
            </Button>
          </>
        )}
      </div>
      {filtering && visibleTransactions.length === 0 && (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          No transactions match.
        </p>
      )}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
          <span className="mr-auto">
            {selected.size} selected
            {hiddenSelected > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({hiddenSelected} hidden by the filter - not affected)
              </span>
            )}
          </span>
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
              <SelectTrigger className="w-60">
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
              <SelectTrigger className="w-60">
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
            <DebtTagControl
              kind={allSelectedIncome ? "loan" : "repayment"}
              idPrefix="bulk"
              tagDebt={bulkTagDebt}
              onTagDebtChange={handleBulkTagChange}
              people={people}
              personId={bulkPerson.personId}
              onPersonIdChange={bulkPerson.setPersonId}
              newPersonName={bulkPerson.newPersonName}
              onNewPersonNameChange={bulkPerson.setNewPersonName}
            />
          )}
          <Button size="sm" onClick={bulkApprove} disabled={pending || !(bulkValue || allSelectedPicked)}>
            Approve selected
          </Button>
          {!bulkValue && !allSelectedPicked && (
            <span className="text-xs text-muted-foreground">
              {allSelectedExpense || allSelectedIncome
                ? "Pick a category above for all, or pick one on each row"
                : "Pick a category on each row (mixed in/out)"}
            </span>
          )}
          {bulkError && <span className="text-xs text-status-critical">{bulkError}</span>}
          <Button size="sm" variant="outline" onClick={bulkIgnore} disabled={pending || selectedTransactions.length === 0}>
            Ignore selected
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox
                checked={eligibleTransactions.length > 0 && eligibleTransactions.every((t) => selected.has(t.id))}
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
          {ordered.map((t) => (
            <ReviewTransactionRow
              key={t.id}
              hidden={scores.get(t.id) === 0}
              showAccount={accounts.length > 1}
              transaction={t}
              categories={categories}
              incomeSources={incomeSources}
              people={people}
              selected={selected.has(t.id)}
              onToggleSelected={toggle}
              onSelect={select}
              onPick={onPick}
              onRegisterApprove={onRegisterApprove}
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
