"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "@/lib/action-result";
import { inviteUserAction, setUserDisabledAction, relinkUserSubAction, deleteUserAction } from "@/app/settings/users-actions";

export type PublicUser = {
  id: number;
  email: string;
  name: string | null;
  isAdmin: boolean;
  disabledAt: string | null;
  linked: boolean;
  createdAt: string;
  /** Precomputed server-side (needs ALLOWED_EMAIL) so this component never
   * needs that env value itself - see lib/accounts-rules.ts's canDisable,
   * which is also the rule for deleting (canDelete is the same check). */
  canDisable: boolean;
};

export function UsersPanel({ users }: { users: PublicUser[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [relinkFor, setRelinkFor] = useState<number | null>(null);
  const [relinkValue, setRelinkValue] = useState("");
  const [deleting, setDeleting] = useState<PublicUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function invite() {
    setError(null);
    setInviting(true);
    const err = await runAction(() => inviteUserAction(email));
    setInviting(false);
    if (err) return setError(err);
    setEmail("");
    router.refresh();
  }

  async function toggleDisabled(user: PublicUser) {
    setBusyId(user.id);
    setError(null);
    const err = await runAction(() => setUserDisabledAction(user.id, !user.disabledAt));
    setBusyId(null);
    if (err) return setError(err);
    router.refresh();
  }

  async function relink(id: number) {
    setBusyId(id);
    setError(null);
    const err = await runAction(() => relinkUserSubAction(id, relinkValue));
    setBusyId(null);
    if (err) return setError(err);
    setRelinkFor(null);
    setRelinkValue("");
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const err = await runAction(() => deleteUserAction(deleting.id));
    setDeleteBusy(false);
    setDeleting(null);
    if (err) return setError(err);
    router.refresh();
  }

  return (
    <div className="space-y-4" data-testid="users-panel">
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Invite someone</h2>
        <p className="text-xs text-muted-foreground">
          They sign in with their own pocket-id account using this email - their own encrypted data starts empty.
        </p>
        <div className="flex max-w-sm items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="button" variant="outline" disabled={!email || inviting} onClick={invite}>
            <UserPlus className="size-4" />
            {inviting ? "Inviting…" : "Invite"}
          </Button>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="text-sm font-medium">Accounts</h2>
        <div className="space-y-2">
          {users.map((user) => (
            <div key={user.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {user.name || user.email}
                    {user.isAdmin && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary">Admin</span>}
                    {user.disabledAt && (
                      <span className="ml-2 rounded bg-status-critical/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-status-critical">
                        Disabled
                      </span>
                    )}
                    {!user.linked && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">Invited, not signed in yet</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {user.email} · joined {user.createdAt}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {user.canDisable && (
                    <Button type="button" size="sm" variant="outline" disabled={busyId === user.id} onClick={() => toggleDisabled(user)}>
                      {user.disabledAt ? "Enable" : "Disable"}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" disabled={busyId === user.id} onClick={() => setRelinkFor(relinkFor === user.id ? null : user.id)}>
                    Re-link identity
                  </Button>
                  {user.canDisable && (
                    <Button type="button" size="sm" variant="destructive" disabled={busyId === user.id} onClick={() => setDeleting(user)}>
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              {relinkFor === user.id && (
                <div className="mt-2 flex max-w-md items-end gap-2 border-t border-border pt-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`relink-${user.id}`}>New sub (from pocket-id)</Label>
                    <Input id={`relink-${user.id}`} value={relinkValue} onChange={(e) => setRelinkValue(e.target.value)} />
                  </div>
                  <Button type="button" size="sm" disabled={!relinkValue || busyId === user.id} onClick={() => relink(user.id)}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <Dialog open={deleting !== null} onOpenChange={(next) => !deleteBusy && !next && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name || deleting?.email}?</DialogTitle>
            <DialogDescription>
              This permanently deletes their account AND their encrypted data file - there is no undo, no safety copy. Disabling (not
              deleting) is reversible if you just want to block their login.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleteBusy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleteBusy} onClick={confirmDelete}>
              {deleteBusy ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
