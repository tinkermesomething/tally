"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, X, TriangleAlert, Pencil, StickyNote, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import {
  categorizeImportedTransaction,
  categorizeImportedTransactionAsIncome,
  ignoreImportedTransaction,
  confirmImportedTransactionMatch,
  discardImportedTransactionMatch,
  saveImportedTransactionNote,
} from "@/app/review/actions";
import { NEW_PERSON, usePersonSelection } from "@/components/grid/person-picker";
import type { RuleContext } from "@/components/review/rule-dialog";
import { DebtTagControl } from "@/components/review/debt-tag-control";
import { findLoansSourceId } from "@/lib/loans";

export type ReviewRow = {
  id: number;
  amountPence: number;
  bookingDate: string;
  payeeRaw: string;
  payeeClean: string | null;
  note: string | null;
  accountId: number;
  accountName: string;
  duplicateOf: {
    id: number;
    categoryName: string;
    amountPence: number;
    entryDate: string;
    note: string | null;
    provisional: boolean;
  } | null;
};

export function ReviewTransactionRow({
  transaction,
  categories,
  incomeSources,
  people,
  selected,
  onToggleSelected,
  onSelect,
  onPick,
  onRegisterApprove,
  onOpenRule,
  hidden = false,
  showAccount = false,
}: {
  transaction: ReviewRow;
  categories: { id: number; name: string }[];
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
  selected: boolean;
  onToggleSelected: (id: number) => void;
  /** Ticks this row (never unticks) - called when a category/source is picked. */
  onSelect: (id: number) => void;
  /** Tells the list whether this row currently has a category/source chosen. */
  onPick: (id: number, picked: boolean) => void;
  /** Hands the list this row's approve action, so "Approve selected" can
   * approve each ticked row with its own pick. Null when the row goes away. */
  onRegisterApprove: (id: number, approve: (() => Promise<string | null>) | null) => void;
  /** Filtered out: stays mounted (so a category already picked here isn't
   * lost) but not shown. */
  hidden?: boolean;
  /** Show which bank account this came from (only useful with several). */
  showAccount?: boolean;
  /** Opens the list-level Rule window for this transaction. */
  onOpenRule: (context: Omit<RuleContext, "openId">) => void;
}) {
  const { currency, dateFormat } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [incomeSourceId, setIncomeSourceId] = useState("");
  const [tagDebt, setTagDebt] = useState(false);
  const { personId, setPersonId, newPersonName, setNewPersonName, resolvePersonId } = usePersonSelection();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(transaction.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // Escape discards; the input then unmounts, and some browsers still fire
  // blur on the way out - which must not save the discarded text.
  const noteCancelled = useRef(false);

  function saveNote(next: string) {
    setEditingNote(false);
    const cleaned = next.replace(/\s+/g, " ").trim();
    if (cleaned === note) return;
    const previous = note;
    setNote(cleaned);
    setNoteError(null);
    startTransition(async () => {
      try {
        await saveImportedTransactionNote(transaction.id, cleaned);
      } catch (err) {
        setNote(previous);
        setNoteError(err instanceof Error ? err.message : "Couldn't save the note.");
      }
    });
  }

  // Staging imports both directions - money in (positive) can only ever
  // become income, money out (negative) only ever an expense. Either can
  // carry a person: an expense as a repayment to them, income as a loan
  // from them (both land on the Debt ledger).
  const isIncome = transaction.amountPence > 0;

  function handleTagDebtChange(next: boolean) {
    setTagDebt(next);
    // Tagging incoming money as a loan suggests the loans income source,
    // but only when nothing is chosen yet - never overrides a deliberate pick.
    if (next && isIncome && !incomeSourceId) {
      const loansId = findLoansSourceId(incomeSources);
      if (loansId) setIncomeSourceId(loansId);
    }
  }

  /** Validates and categorizes this row with its own pick. Resolves to an
   * error message, or null when it worked. */
  async function approve(): Promise<string | null> {
    if (isIncome ? !incomeSourceId : !categoryId) {
      return isIncome ? "Pick an income source first." : "Pick a category first.";
    }
    if (tagDebt && !personId) {
      return isIncome
        ? "Pick who you borrowed this from, or turn off the loan tag."
        : "Pick who this repayment is to, or turn off the debt tag.";
    }
    if (tagDebt && personId === NEW_PERSON && !newPersonName.trim()) {
      return "Enter the new person's name.";
    }
    try {
      const debtPersonId = tagDebt ? await resolvePersonId() : undefined;
      if (isIncome) {
        await categorizeImportedTransactionAsIncome(transaction.id, {
          incomeSourceId: parseInt(incomeSourceId, 10),
          debtPersonId,
        });
      } else {
        await categorizeImportedTransaction(transaction.id, { categoryId: parseInt(categoryId, 10), debtPersonId });
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Failed to categorize.";
    }
  }

  function handleCategorize() {
    startTransition(async () => {
      setError(await approve());
    });
  }

  // A provisional match is resolved with Confirm/Discard, never approved.
  const isProvisional = !!transaction.duplicateOf?.provisional;
  const pick = isIncome ? incomeSourceId : categoryId;
  useEffect(() => {
    onPick(transaction.id, !isProvisional && !!pick);
    return () => onPick(transaction.id, false);
  }, [transaction.id, isProvisional, pick, onPick]);
  useEffect(() => {
    if (isProvisional) return;
    onRegisterApprove(transaction.id, async () => {
      const err = await approve();
      setError(err);
      return err;
    });
    return () => onRegisterApprove(transaction.id, null);
  });

  function handleIgnore() {
    startTransition(() => ignoreImportedTransaction(transaction.id));
  }

  function handleConfirmMatch() {
    if (!transaction.duplicateOf) return;
    startTransition(() => confirmImportedTransactionMatch(transaction.id, transaction.duplicateOf!.id));
  }

  function handleDiscardMatch() {
    if (!transaction.duplicateOf) return;
    startTransition(() => discardImportedTransactionMatch(transaction.duplicateOf!.id));
  }

  // A provisional match is your own deliberate pencilled-in guess, not a
  // generic "might be a coincidental dupe" warning - different mental
  // model, different controls (Confirm/Discard instead of pick-a-category).
  const provisionalMatch = transaction.duplicateOf?.provisional ? transaction.duplicateOf : null;

  const duplicateTitle = provisionalMatch
    ? `Pencilled in as ${provisionalMatch.categoryName}, ${formatPence(
        provisionalMatch.amountPence,
        currency
      )} on ${formatDate(provisionalMatch.entryDate, dateFormat)}. Confirm if this is it, Discard if not.`
    : transaction.duplicateOf
      ? `Might already be logged as ${transaction.duplicateOf.categoryName}, ${formatPence(
          transaction.duplicateOf.amountPence,
          currency
        )} on ${formatDate(transaction.duplicateOf.entryDate, dateFormat)}${
          transaction.duplicateOf.note ? ` ("${transaction.duplicateOf.note}")` : ""
        }. Only a suggestion.`
      : undefined;

  if (provisionalMatch) {
    return (
      <TableRow className={hidden ? "hidden" : undefined}>
        <TableCell>
          <Checkbox checked={false} disabled aria-label="Resolve this match first" title="Resolve this match first" />
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatDate(transaction.bookingDate, dateFormat)}
          {showAccount && <span className="block truncate" data-testid="row-account">{transaction.accountName}</span>}
        </TableCell>
        <TableCell className="max-w-48 min-w-0 whitespace-normal">
          <div className="flex items-center gap-1.5">
            <span title={duplicateTitle}>
              <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{transaction.payeeClean ?? transaction.payeeRaw}</p>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          −{formatPence(Math.abs(transaction.amountPence), currency)}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground" colSpan={2}>
          Pencilled in: {provisionalMatch.categoryName}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Button size="icon-xs" onClick={handleConfirmMatch} disabled={pending} title="Confirm match">
              <Check className="size-3.5" />
            </Button>
            <Button size="icon-xs" variant="outline" onClick={handleDiscardMatch} disabled={pending} title="Discard - wasn't a match">
              <X className="size-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow data-state={selected ? "selected" : undefined} className={hidden ? "hidden" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected(transaction.id)}
          aria-label="Select for bulk action"
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(transaction.bookingDate, dateFormat)}
        {showAccount && <span className="block truncate" data-testid="row-account">{transaction.accountName}</span>}
      </TableCell>
      <TableCell className="max-w-48 min-w-0 whitespace-normal">
        <div className="flex items-center gap-1.5">
          {transaction.duplicateOf && (
            <span title={duplicateTitle}>
              <TriangleAlert className="size-3.5 shrink-0 text-status-critical" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{transaction.payeeClean ?? transaction.payeeRaw}</p>
            {transaction.payeeClean && (
              <p className="truncate text-xs text-muted-foreground">{transaction.payeeRaw}</p>
            )}
            {editingNote ? (
              <input
                autoFocus
                defaultValue={note}
                maxLength={200}
                placeholder="What was this?"
                aria-label="Note"
                onBlur={(e) => {
                  if (noteCancelled.current) {
                    noteCancelled.current = false;
                    return;
                  }
                  saveNote(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    noteCancelled.current = true;
                    setEditingNote(false);
                  }
                }}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-1.5 py-0.5 text-xs outline-none focus:border-ring"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  noteCancelled.current = false;
                  setEditingNote(true);
                }}
                title={note ? "Edit note" : "Add a note"}
                className="mt-0.5 flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <StickyNote className="size-3 shrink-0" />
                <span className="truncate">{note || "Add a note"}</span>
              </button>
            )}
            {noteError && <p className="text-xs text-status-critical">{noteError}</p>}
          </div>
        </div>
      </TableCell>
      <TableCell className={`text-right font-semibold tabular-nums ${isIncome ? "text-status-good" : ""}`}>
        {isIncome ? "+" : "−"}
        {formatPence(Math.abs(transaction.amountPence), currency)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
        {isIncome ? (
          <Select
            value={incomeSourceId}
            onValueChange={(v) => {
              setIncomeSourceId(v ?? "");
              // Picking a source ticks the row, so several categorized rows
              // can be approved together without ticking each one by hand.
              if (v) onSelect(transaction.id);
            }}
          >
            <SelectTrigger className="w-60" title={incomeSources.find((s) => String(s.id) === incomeSourceId)?.name}>
              <SelectValue>
                {(value: string) =>
                  value
                    ? (incomeSources.find((s) => String(s.id) === value)?.name ?? value)
                    : "Choose a source"
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
        ) : (
          <Select
            value={categoryId}
            onValueChange={(v) => {
              setCategoryId(v ?? "");
              if (v) onSelect(transaction.id);
            }}
          >
            <SelectTrigger className="w-60" title={categories.find((c) => String(c.id) === categoryId)?.name}>
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
        <Button
          size="xs"
          variant="outline"
          title="Create a rule from this transaction"
          onClick={() =>
            onOpenRule({
              transaction: { payeeRaw: transaction.payeeRaw, payeeClean: transaction.payeeClean },
              isIncome,
              initialCategoryId: categoryId,
              initialIncomeSourceId: incomeSourceId,
              initialTagDebt: tagDebt && !!personId && personId !== NEW_PERSON,
              initialPersonId: personId !== NEW_PERSON ? personId : "",
            })
          }
        >
          <Zap className="size-3" />
          Rule
        </Button>
        </div>
      </TableCell>
      <TableCell>
        <DebtTagControl
          kind={isIncome ? "loan" : "repayment"}
          idPrefix={`review-${transaction.id}`}
          tagDebt={tagDebt}
          onTagDebtChange={handleTagDebtChange}
          people={people}
          personId={personId}
          onPersonIdChange={setPersonId}
          newPersonName={newPersonName}
          onNewPersonNameChange={setNewPersonName}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button size="icon-xs" onClick={handleCategorize} disabled={pending} title="Categorize">
            <Check className="size-3.5" />
          </Button>
          <Button size="icon-xs" variant="outline" onClick={handleIgnore} disabled={pending} title="Ignore">
            <X className="size-3.5" />
          </Button>
        </div>
        {error && <p className="mt-1 max-w-32 text-xs text-status-critical">{error}</p>}
      </TableCell>
    </TableRow>
  );
}
