"use client";

import { useState, useTransition, useRef } from "react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { pencilInPendingIncome } from "@/app/review/actions";
import { NEW_PERSON, PersonPickerField, usePersonSelection } from "@/components/grid/person-picker";

export type PendingIncomeRuleMatch = { incomeSourceId: number; incomeSourceName: string; debtPersonId?: number };

/** Money-in's exact mirror of PencilInButton - lets a pending-at-the-bank
 * credit be logged as real income ahead of it settling, so "left to
 * spend" reflects money the bank's already earmarked instead of waiting
 * on it to actually clear. */
export function PencilInIncomeButton({
  amountPence,
  date,
  payeeRaw,
  incomeSources,
  people,
  ruleMatch,
}: {
  amountPence: number;
  date: string | null;
  payeeRaw: string;
  incomeSources: { id: number; name: string; requiresDebtPerson: boolean }[];
  people: { id: number; name: string }[];
  ruleMatch?: PendingIncomeRuleMatch | null;
}) {
  const [open, setOpen] = useState(false);
  const [incomeSourceId, setIncomeSourceId] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { personId, setPersonId, newPersonName, setNewPersonName, resolvePersonId } = usePersonSelection();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const requiredSource = !!incomeSources.find((s) => String(s.id) === incomeSourceId)?.requiresDebtPerson;

  if (done) {
    return <span className="text-xs text-muted-foreground">Pencilled in</span>;
  }

  function pencilIn(sourceId: number, debtPersonId?: number) {
    setError(null);
    startTransition(async () => {
      try {
        await pencilInPendingIncome({
          incomeSourceId: sourceId,
          amountPence: Math.abs(amountPence),
          entryDate: date,
          note: payeeRaw,
          debtPersonId,
        });
        setDone(true);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't pencil this in.");
      }
    });
  }

  async function submit() {
    if (!incomeSourceId) return;
    if (requiredSource && !personId) return setError("This source requires who the money is from.");
    if (requiredSource && personId === NEW_PERSON && !newPersonName.trim()) return setError("Enter their name.");
    const debtPersonId = personId ? await resolvePersonId() : undefined;
    pencilIn(parseInt(incomeSourceId, 10), debtPersonId);
  }

  return (
    <span className="inline-flex items-center gap-1">
      {ruleMatch && (
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          title={`A rule already files this under ${ruleMatch.incomeSourceName} - pencil it in the same way`}
          onClick={() => pencilIn(ruleMatch.incomeSourceId, ruleMatch.debtPersonId)}
        >
          <Check className="size-3 text-status-good" />
          Pencil in as {ruleMatch.incomeSourceName}
        </Button>
      )}
      <Button
        ref={anchorRef}
        size="icon-xs"
        variant="ghost"
        title={ruleMatch ? "Pencil in as something else" : "Pencil in as income"}
        onClick={() => setOpen((v) => !v)}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchorRef} align="end" sideOffset={4}>
            <PopoverPopup>
              <div className="w-56 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Logs this now, before it settles. You&apos;ll get Confirm/Discard once the real transaction syncs in.
                </p>
                <Select value={incomeSourceId} onValueChange={(v) => setIncomeSourceId(v ?? "")}>
                  <SelectTrigger className="w-full">
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
                {requiredSource && (
                  <PersonPickerField
                    idPrefix="pencil-in-income"
                    label="Borrowed from"
                    placeholder="Choose who"
                    people={people}
                    personId={personId}
                    onPersonIdChange={setPersonId}
                    newPersonName={newPersonName}
                    onNewPersonNameChange={setNewPersonName}
                  />
                )}
                {error && <p className="text-xs text-status-critical">{error}</p>}
                <Button
                  size="sm"
                  className="w-full"
                  onClick={submit}
                  disabled={pending || !incomeSourceId}
                >
                  Pencil in
                </Button>
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </span>
  );
}
