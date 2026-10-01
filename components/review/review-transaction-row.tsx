"use client";

import { useState, useTransition } from "react";
import { Check, X, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { categorizeImportedTransaction, ignoreImportedTransaction } from "@/app/review/actions";
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
  people,
  selected,
  onToggleSelected,
}: {
  transaction: ReviewRow;
  categories: { id: number; name: string }[];
  people: { id: number; name: string }[];
  selected: boolean;
  onToggleSelected: (id: number) => void;
}) {
  const { currency, dateFormat } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [tagDebt, setTagDebt] = useState(false);
  const { personId, setPersonId, newPersonName, setNewPersonName, resolvePersonId } = usePersonSelection();
  const [error, setError] = useState<string | null>(null);

  function handleCategorize() {
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

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected(transaction.id)}
          className="mt-1 shrink-0"
          aria-label="Select for bulk action"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate font-medium">{transaction.payeeClean ?? transaction.payeeRaw}</p>
          {transaction.payeeClean && (
            <p className="truncate text-xs text-muted-foreground">{transaction.payeeRaw}</p>
          )}
          <p className="text-xs text-muted-foreground">{formatDate(transaction.bookingDate, dateFormat)}</p>
        </div>
        <span className="shrink-0 text-right font-semibold tabular-nums">
          {formatPence(Math.abs(transaction.amountPence), currency)}
        </span>
      </div>

      {transaction.duplicateOf && (
        <div className="flex items-start gap-2 rounded-lg border border-status-critical/30 bg-status-critical/10 p-2 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-status-critical" />
          <p>
            Might already be logged as <strong>{transaction.duplicateOf.categoryName}</strong>,{" "}
            {formatPence(transaction.duplicateOf.amountPence, currency)} on{" "}
            {formatDate(transaction.duplicateOf.entryDate, dateFormat)}
            {transaction.duplicateOf.note ? ` (“${transaction.duplicateOf.note}”)` : ""}. Only a suggestion -
            categorize normally if this is genuinely separate.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
          <SelectTrigger className="w-full sm:w-56">
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

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={tagDebt} onCheckedChange={(checked) => setTagDebt(checked === true)} />
          Paying someone back
        </label>

        <Button size="sm" onClick={handleCategorize} disabled={pending}>
          <Check className="size-3.5" />
          Categorize
        </Button>
        <Button size="sm" variant="outline" onClick={handleIgnore} disabled={pending}>
          <X className="size-3.5" />
          Ignore
        </Button>
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

      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
