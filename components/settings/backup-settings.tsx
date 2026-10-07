"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutoBackupPanel, type AutoBackupView } from "@/components/settings/auto-backup-panel";
import { MIN_BACKUP_PASSWORD } from "@/lib/backup-crypto-shared";

/** Settings > Backup. Two ways to back up: automatic copies into a folder on
 * the server (set up in the stack's .env), and a manual download. Downloads
 * are password-protected by default; a plain file is a deliberate,
 * clearly-labelled choice. Restore takes either kind of file. */
export function BackupSettings({ auto }: { auto: AutoBackupView }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  // back up
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [unprotected, setUnprotected] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  // restore
  const [file, setFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [allowUnprotected, setAllowUnprotected] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function download() {
    setDownloadError(null);
    setDownloaded(null);
    if (!unprotected) {
      if (password.length < MIN_BACKUP_PASSWORD) return setDownloadError(`Use a password of at least ${MIN_BACKUP_PASSWORD} characters.`);
      if (password !== confirm) return setDownloadError("The two passwords don't match.");
    }
    setDownloading(true);
    try {
      const body = new FormData();
      if (unprotected) body.set("unprotected", "1");
      else body.set("password", password);
      const res = await fetch("/settings/backup", { method: "POST", body });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        return setDownloadError(json?.error ?? "The backup failed. Try again.");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "tally-backup";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloaded(unprotected ? `Saved ${name} (no password).` : `Saved ${name}. You need the password to restore it - it cannot be recovered.`);
      setPassword("");
      setConfirm("");
    } catch {
      setDownloadError("The backup failed. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function restore() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      if (restorePassword) body.set("password", restorePassword);
      if (allowUnprotected) body.set("allowUnprotected", "1");
      const res = await fetch("/settings/restore", { method: "POST", body });
      const json = (await res.json()) as { ok: boolean; error?: string; rows?: number; safetyBackup?: string };
      setConfirming(false);
      if (!json.ok) {
        setError(json.error ?? "The restore failed.");
        return;
      }
      setDone(`Restored ${json.rows} records. The data from before is saved on the server as ${json.safetyBackup}.`);
      setFile(null);
      setRestorePassword("");
      setAllowUnprotected(false);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      setConfirming(false);
      setError("The restore failed and nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="backup-settings">
      <AutoBackupPanel auto={auto} />

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="text-sm font-medium">Manual backup</h2>
        <p className="text-xs text-muted-foreground">
          Downloads everything (categories, entries, income, debts, savings, rules, settings) as one file, locked with a password you choose.
          It holds your real figures. Keep the password safe: without it the file cannot be opened, by anyone.
        </p>
        {!unprotected && (
          <div className="grid max-w-sm gap-2">
            <div className="space-y-1">
              <Label htmlFor="backup-password">Backup password</Label>
              <Input id="backup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="backup-confirm">Repeat the password</Label>
              <Input id="backup-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Checkbox checked={unprotected} onCheckedChange={(c) => setUnprotected(c === true)} aria-label="No password (not recommended)" />
          <Label className="font-normal text-muted-foreground">No password (not recommended)</Label>
        </div>
        <Button type="button" variant="outline" disabled={downloading} onClick={download}>
          <Download className="size-4 text-chart-1" />
          {downloading ? "Preparing…" : "Download backup"}
        </Button>
        {downloadError && (
          <p role="alert" className="text-sm text-status-critical" data-testid="backup-error">
            {downloadError}
          </p>
        )}
        {downloaded && (
          <p role="status" className="text-sm text-status-good" data-testid="backup-done">
            {downloaded}
          </p>
        )}
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="text-sm font-medium">Restore</h2>
        <p className="text-xs text-muted-foreground">
          Replaces ALL current data with a backup file. A copy of what is there now is saved on the server first, and nothing changes if the
          password is wrong or the file is not a valid Tally backup.
        </p>
        <input
          ref={input}
          type="file"
          accept=".tallybak,.db,.sqlite,.sqlite3,application/octet-stream"
          aria-label="Backup file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setAllowUnprotected(false);
            setError(null);
            setDone(null);
          }}
          className="max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-3 file:py-1 file:text-sm"
        />
        {file && (
          <div className="grid max-w-sm gap-2">
            {!allowUnprotected && (
              <div className="space-y-1">
                <Label htmlFor="restore-password">Backup password</Label>
                <Input id="restore-password" type="password" autoComplete="off" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox checked={allowUnprotected} onCheckedChange={(c) => setAllowUnprotected(c === true)} aria-label="This file has no password" />
              <Label className="font-normal text-muted-foreground">This file has no password</Label>
            </div>
          </div>
        )}
        <Button type="button" variant="outline" disabled={!file || busy || (!allowUnprotected && !restorePassword)} onClick={() => setConfirming(true)}>
          <Upload className="size-4 text-chart-2" />
          Restore…
        </Button>
        {error && (
          <p role="alert" className="text-sm text-status-critical">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="text-sm text-status-good" data-testid="restore-done">
            {done}
          </p>
        )}
      </section>

      <Dialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace all data?</DialogTitle>
            <DialogDescription>
              Everything in Tally now will be replaced by the contents of <span className="font-medium">{file?.name}</span>. A copy of the current
              data is kept on the server so this can be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={restore}>
              {busy ? "Restoring…" : "Replace all data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
