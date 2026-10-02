"use client";

import { useState, useTransition, useRef } from "react";
import { Check, X, TriangleAlert, UserRound } from "lucide-react";
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
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import {
  categorizeImportedTransaction,
  categorizeImportedTransactionAsIncome,
  ignoreImportedTransaction,
} from "@/app/review/actions";
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";

export type ReviewRow = {
  id: number;
  amountPence: number;
  bookingDate: string;
  payeeRaw: string;
  payeeClean: string | null;
  duplicateOf: { categoryName: string; amountPence: number; entryDate: string; note: string | null } | null;
};

export function ReviewTransactionRow({
  transaction,
  categories,
  incomeSources,
  people,
  selected,
  onToggleSelected,
}: {
  transaction: ReviewRow;
  categories: { id: number; name: string }[];
  incomeSources: { id: number; name: string }[];
  people: { id: number; name: string }[];
  selected: boolean;
  onToggleSelected: (id: number) => void;
}) {
  const { currency, dateFormat } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [incomeSourceId, setIncomeSourceId] = useState("");
  const [tagDebt, setTagDebt] = useState(false);
  const [debtPopoverOpen, setDebtPopoverOpen] = useState(false);
  const { personId, setPersonId, newPersonName, setNewPersonName, resolvePersonId } = usePersonSelection();
  const [error, setError] = useState<string | null>(null);
  const debtAnchorRef = useRef<HTMLButtonElement>(null);

  // Staging imports both directions - money in (positive) can only ever
  // become income, money out (negative) only ever an expense. Debt-tagging
  // is expense-only (the debt ledger already models a repayment TO you as
  // its own entry, unconnected to bank-sync).
  const isIncome = transaction.amountPence > 0;

  function handleCategorize() {
    if (isIncome) {
      if (!incomeSourceId) {
        setError("Pick an income source first.");
        return;
      }
      setError(null);
      startTransition(async () => {
        try {
          await categorizeImportedTransactionAsIncome(transaction.id, { incomeSourceId: parseInt(incomeSourceId, 10) });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to categorize.");
        }
      });
      return;
    }

    if (!categoryId) {
      setError("Pick a category first.");
      return;
    }
    if (tagDebt && !personId) {
      setError("Pick who this repayment is to, or turn off the debt tag.");
      return;
    }
    if (tagDebt && personId === NEW_PERSON && !newPersonName.trim()) {
      setError("Enter the new person's name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const debtPersonId = tagDebt ? await resolvePersonId() : undefined;
        await categorizeImportedTransaction(transaction.id, { categoryId: parseInt(categoryId, 10), debtPersonId });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to categorize.");
      }
    });
  }

  function handleIgnore() {
    startTransition(() => ignoreImportedTransaction(transaction.id));
  }

  const duplicateTitle = transaction.duplicateOf
    ? `Might already be logged as ${transaction.duplicateOf.categoryName}, ${formatPence(
        transaction.duplicateOf.amountPence,
        currency
      )} on ${formatDate(transaction.duplicateOf.entryDate, dateFormat)}${
        transaction.duplicateOf.note ? ` ("${transaction.duplicateOf.note}")` : ""
      }. Only a suggestion.`
    : undefined;

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected(transaction.id)}
          aria-label="Select for bulk action"
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDate(transaction.bookingDate, dateFormat)}
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
          </div>
        </div>
      </TableCell>
      <TableCell className={`text-right font-semibold tabular-nums ${isIncome ? "text-status-good" : ""}`}>
        {isIncome ? "+" : "−"}
        {formatPence(Math.abs(transaction.amountPence), currency)}
      </TableCell>
      <TableCell>
        {isIncome ? (
          <Select value={incomeSourceId} onValueChange={(v) => setIncomeSourceId(v ?? "")}>
            <SelectTrigger className="w-44">
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
          <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
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
      </TableCell>
      <TableCell>
        {!isIncome && (
          <>
            <Button
              ref={debtAnchorRef}
              size="icon-xs"
              variant={tagDebt ? "secondary" : "ghost"}
              title={tagDebt ? "Paying someone back - click to edit" : "Tag as paying someone back"}
              onClick={() => setDebtPopoverOpen((v) => !v)}
            >
              <UserRound className="size-3.5" />
            </Button>
            <Popover open={debtPopoverOpen} onOpenChange={setDebtPopoverOpen}>
              <PopoverPortal>
                <PopoverPositioner anchor={debtAnchorRef} align="start" sideOffset={4}>
                  <PopoverPopup>
                    <div className="flex items-center gap-2 pb-2">
                      <Checkbox checked={tagDebt} onCheckedChange={(checked) => setTagDebt(checked === true)} />
                      <span className="text-sm">Paying someone back</span>
                    </div>
                    {tagDebt && (
                      <PersonPickerField
                        idPrefix={`review-${transaction.id}`}
                        label="Paying back"
                        placeholder="Choose who"
                        people={people}
                        personId={personId}
                        onPersonIdChange={setPersonId}
                        newPersonName={newPersonName}
                        onNewPersonNameChange={setNewPersonName}
                      />
                    )}
                  </PopoverPopup>
                </PopoverPositioner>
              </PopoverPortal>
            </Popover>
          </>
        )}
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
