"use client";

import { useState, useTransition } from "react";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { listBankInstitutions, startBankConnection } from "@/app/settings/bank-sync-actions";

type Institution = {
  id: string;
  name: string;
  transaction_total_days: number;
  max_access_valid_for_days: number;
};

export function ConnectBankAccountDialog() {
  const [open, setOpen] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && institutions === null) {
      startTransition(async () => {
        try {
          setInstitutions(await listBankInstitutions());
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load banks.");
        }
      });
    }
  }

  function handleSelect(institution: Institution) {
    setError(null);
    startTransition(async () => {
      try {
        const { link } = await startBankConnection(institution);
        window.location.href = link;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start connection.");
      }
    });
  }

  const filtered = institutions?.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Landmark className="size-4" />
            Connect account
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a bank account</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Search banks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {institutions === null ? (
            <p className="text-sm text-muted-foreground">Loading banks…</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filtered?.length === 0 && (
                <p className="text-sm text-muted-foreground">No banks match that search.</p>
              )}
              {filtered?.map((institution) => (
                <button
                  key={institution.id}
                  type="button"
                  disabled={pending}
                  onClick={() => handleSelect(institution)}
                  className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  {institution.name}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <p className="text-xs text-muted-foreground">
            You&apos;ll be redirected to your bank to authorize access, then brought back here.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
