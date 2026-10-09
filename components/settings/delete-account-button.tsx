"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteOwnAccountAction } from "@/app/settings/actions";

/** Self-service deletion - only ever rendered for a non-admin (see
 * app/settings/page.tsx), though the real enforcement is server-side
 * (lib/db/users.ts's deleteUser refuses an admin deleting themselves). A
 * success redirects via signOut and never returns here - this only ever
 * has to handle the failure case. */
export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await deleteOwnAccountAction();
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        Delete my account
      </Button>
      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account and all your encrypted data - there is no undo, no safety copy. You&apos;ll be signed
              out immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={confirm}>
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
