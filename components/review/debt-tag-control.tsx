"use client";

import { useRef, useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverPortal, PopoverPositioner, PopoverPopup } from "@/components/ui/popover";
import { PersonPickerField } from "@/components/grid/person-picker";

/** repayment: money OUT paying someone back. loan: money IN borrowed from
 * someone. Same control and same person picker (including "+ New…")
 * either way - only the wording differs. */
export type DebtKind = "repayment" | "loan";

const COPY: Record<DebtKind, { off: string; on: string; check: string; picker: string }> = {
  repayment: {
    off: "Tag as paying someone back",
    on: "Paying someone back - click to edit",
    check: "Paying someone back",
    picker: "Paying back",
  },
  loan: {
    off: "Tag as a loan from someone",
    on: "Loan from someone - click to edit",
    check: "Loan - borrowed from someone (adds to Debt)",
    picker: "Borrowed from",
  },
};

export function DebtTagControl({
  kind,
  idPrefix,
  tagDebt,
  onTagDebtChange,
  people,
  personId,
  onPersonIdChange,
  newPersonName,
  onNewPersonNameChange,
  required = false,
}: {
  kind: DebtKind;
  idPrefix: string;
  tagDebt: boolean;
  onTagDebtChange: (next: boolean) => void;
  people: { id: number; name: string }[];
  personId: string;
  onPersonIdChange: (id: string) => void;
  newPersonName: string;
  onNewPersonNameChange: (name: string) => void;
  /** The chosen source requires a person on every entry - the checkbox is
   * hidden (there's nothing to turn off) and the picker always shows. */
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const copy = COPY[kind];
  const title = required ? "This source requires who the money is from" : tagDebt ? copy.on : copy.off;

  return (
    <>
      <Button
        ref={anchorRef}
        size="icon-xs"
        variant={tagDebt || required ? "secondary" : "ghost"}
        title={title}
        aria-label={title}
        onClick={() => setOpen((v) => !v)}
      >
        <UserRound className="size-3.5" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverPortal>
          <PopoverPositioner anchor={anchorRef} align="start" sideOffset={4}>
            <PopoverPopup>
              {required ? (
                <p className="pb-2 text-sm">Required: who is this from?</p>
              ) : (
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox checked={tagDebt} onCheckedChange={(checked) => onTagDebtChange(checked === true)} />
                  <span className="text-sm">{copy.check}</span>
                </div>
              )}
              {(tagDebt || required) && (
                <PersonPickerField
                  idPrefix={idPrefix}
                  label={copy.picker}
                  placeholder="Choose who"
                  people={people}
                  personId={personId}
                  onPersonIdChange={onPersonIdChange}
                  newPersonName={newPersonName}
                  onNewPersonNameChange={onNewPersonNameChange}
                />
              )}
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  );
}
