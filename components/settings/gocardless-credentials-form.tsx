"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/lib/action-result";
import { saveGocardlessCredentialsAction, clearGocardlessCredentialsAction } from "@/app/settings/bank-sync-actions";

/** Your OWN GoCardless API credentials (Settings > Bank sync) - stored in
 * your own encrypted account file, never a shared instance-wide secret.
 * The secret key is write-only here: once saved, this form never shows it
 * back, same convention as a password field. */
export function GocardlessCredentialsForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!configured);
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const err = await runAction(() => saveGocardlessCredentialsAction(secretId, secretKey));
    setBusy(false);
    if (err) return setError(err);
    setSecretId("");
    setSecretKey("");
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const err = await runAction(() => clearGocardlessCredentialsAction());
    setBusy(false);
    if (err) return setError(err);
    setEditing(true);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <p className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4 text-status-good" />
          GoCardless credentials are configured.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={remove}>
            <Trash2 className="size-4" />
            Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        From your own GoCardless Bank Account Data app registration (bankaccountdata.gocardless.com) - not shared with anyone else on
        this instance.
      </p>
      <div className="grid max-w-sm gap-2">
        <div className="space-y-1">
          <Label htmlFor="gc-secret-id">Secret id</Label>
          <Input id="gc-secret-id" value={secretId} onChange={(e) => setSecretId(e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gc-secret-key">Secret key</Label>
          <Input id="gc-secret-key" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!secretId || !secretKey || busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {configured && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}
    </div>
  );
}
