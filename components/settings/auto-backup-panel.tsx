"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { updatePreferences } from "@/app/settings/actions";
import { backUpNow, resetAutoBackupSettings, saveAutoBackupSettings } from "@/app/settings/backup-actions";
import { FREQUENCIES, MAX_KEEP, WEEKDAYS } from "@/lib/auto-backup-settings";
import { MIN_BACKUP_PASSWORD } from "@/lib/backup-crypto-shared";

export type AutoBackupView = {
  /** A folder is set (saved here or from the .env). */
  enabled: boolean;
  /** Switched off with the switch. */
  paused: boolean;
  dir: string | null;
  protected: boolean;
  /** "Every day at 03:00 (Europe/London)" */
  when: string | null;
  /** formatted time of the next run, or null when due now */
  next: string | null;
  total: number;
  writable: boolean;
  problem: string | null;
  lastError: string | null;
  files: { name: string; size: number; at: string }[];
  form: { dir: string; frequencyHours: number; hour: number; weekday: number; keep: number; protect: boolean; passwordSet: boolean; passwordFromEnv: boolean };
  envDir: string | null;
  hasSaved: boolean;
};

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const hours = Array.from({ length: 24 }, (_, h) => h);

/** Settings > Backup > Automatic backups: the on/off switch, the status, and
 * one edit popup for everything (folder, how often, time, how many to keep,
 * password). */
export function AutoBackupPanel({ auto }: { auto: AutoBackupView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(!auto.paused);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // the edit form
  const f = auto.form;
  const [dir, setDir] = useState(f.dir);
  const [frequencyHours, setFrequencyHours] = useState(f.frequencyHours);
  const [hour, setHour] = useState(f.hour);
  const [weekday, setWeekday] = useState(f.weekday);
  const [keep, setKeep] = useState(String(f.keep));
  const [protect, setProtect] = useState(f.protect);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function openEditor() {
    setDir(f.dir);
    setFrequencyHours(f.frequencyHours);
    setHour(f.hour);
    setWeekday(f.weekday);
    setKeep(String(f.keep));
    setProtect(f.protect);
    setPassword("");
    setConfirm("");
    setError(null);
    setNote(null);
    setEditing(true);
  }

  async function toggle(next: boolean) {
    setOn(next);
    setError(null);
    try {
      await updatePreferences({ autoBackupEnabled: next });
      router.refresh();
    } catch {
      setOn(!next);
      setError("Couldn't change that. Try again.");
    }
  }

  function save() {
    setError(null);
    setNote(null);
    if (protect && password) {
      if (password.length < MIN_BACKUP_PASSWORD) return setError(`Use a password of at least ${MIN_BACKUP_PASSWORD} characters.`);
      if (password !== confirm) return setError("The two passwords don't match.");
    }
    startTransition(async () => {
      const res = await saveAutoBackupSettings({ dir, frequencyHours, hour, weekday, keep: Number(keep), protect, password: password || undefined });
      if (!res.ok) return setError(res.error);
      setPassword("");
      setConfirm("");
      setEditing(false);
      setNote("Saved.");
      router.refresh();
    });
  }

  function reset() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await resetAutoBackupSettings();
      if (!res.ok) return setError(res.error);
      setEditing(false);
      router.refresh();
    });
  }

  function runNow() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await backUpNow();
      if (!res.ok) return setError(res.error);
      setNote(`Backed up now: ${res.name}`);
      router.refresh();
    });
  }

  return (
    <section className="space-y-2" data-testid="auto-backup">
      <h2 className="text-sm font-medium">Automatic backups</h2>

      {auto.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm">Back up automatically</p>
            <p className="text-xs text-muted-foreground" data-testid="auto-backup-state">
              {on ? (
                <>
                  <span className="font-medium text-status-good">On</span> · {auto.when} · {auto.next ? `next ${auto.next}` : "next one is due now"} · keeps the last{" "}
                  {auto.form.keep}
                </>
              ) : (
                <>
                  <span className="font-medium">Paused</span> · no automatic backups are made. Turn it back on any time; files already in the folder are kept.
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={openEditor}>
              <Pencil className="size-3.5 text-chart-1" />
              Edit
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={runNow}>
              Back up now
            </Button>
            <Switch checked={on} onCheckedChange={toggle} aria-label="Back up automatically" />
          </div>
        </div>
      )}

      {auto.enabled && (
        <>
          <p className="text-xs text-muted-foreground">
            Saved to <code className="rounded bg-muted px-1">{auto.dir}</code> ·{" "}
            {auto.protected ? "password-protected" : <span className="text-status-critical">NOT password-protected</span>}
          </p>
          {on && !auto.writable && (
            <p role="alert" className="text-sm text-status-critical">
              That folder can&apos;t be written to. Check the mount and its permissions (the app runs as user 1000).
            </p>
          )}
          {on && auto.problem && (
            <p role="alert" className="text-sm text-status-critical" data-testid="auto-backup-problem">
              {auto.problem}
            </p>
          )}
          {on && auto.lastError && !auto.problem && (
            <p role="alert" className="text-sm text-status-critical">
              The last automatic backup failed: {auto.lastError}
            </p>
          )}
          {auto.files.length === 0 ? (
            <p className="text-xs text-muted-foreground">No automatic backup yet.</p>
          ) : (
            <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="auto-backup-files">
              {auto.files.map((file) => (
                <li key={file.name} className="flex justify-between gap-3">
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {file.at} · {kb(file.size)}
                  </span>
                </li>
              ))}
              {auto.total > auto.files.length && <li>…and {auto.total - auto.files.length} older</li>}
            </ul>
          )}
        </>
      )}

      {!auto.enabled && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Not set up yet. Choose a folder, a schedule and a password.</p>
          <Button type="button" size="sm" variant="outline" onClick={openEditor}>
            <Pencil className="size-3.5 text-chart-1" />
            Set up automatic backups
          </Button>
        </div>
      )}

      <Dialog open={editing} onOpenChange={(next) => !pending && setEditing(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="auto-backup-form">
          <DialogHeader>
            <DialogTitle>Automatic backups</DialogTitle>
            <DialogDescription>Where, how often and for how long backups are kept, and the password that protects them.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="auto-dir">Save to folder</Label>
            <Input id="auto-dir" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={auto.envDir ?? "/app/backups"} spellCheck={false} />
            <p className="text-xs text-muted-foreground">
              A path inside the container. For backups outside it, mount a host folder there in the stack&apos;s compose file. Saving checks it can be written.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="auto-frequency">How often</Label>
              <Select value={String(frequencyHours)} onValueChange={(v) => setFrequencyHours(Number(v))}>
                <SelectTrigger id="auto-frequency" className="w-full">
                  <SelectValue>{(v: string) => FREQUENCIES.find((x) => String(x.hours) === v)?.label ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((x) => (
                    <SelectItem key={x.hours} value={String(x.hours)}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="auto-hour">{frequencyHours < 24 ? "Starting at" : "At"}</Label>
              <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                <SelectTrigger id="auto-hour" className="w-full">
                  <SelectValue>{(v: string) => `${String(v).padStart(2, "0")}:00`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {hours.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {frequencyHours === 168 && (
            <div className="space-y-1">
              <Label htmlFor="auto-weekday">On</Label>
              <Select value={String(weekday)} onValueChange={(v) => setWeekday(Number(v))}>
                <SelectTrigger id="auto-weekday" className="w-full">
                  <SelectValue>{(v: string) => WEEKDAYS[Number(v)]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="auto-keep">Keep the last</Label>
            <div className="flex items-center gap-2">
              <Input id="auto-keep" type="number" inputMode="numeric" min={1} max={MAX_KEEP} value={keep} onChange={(e) => setKeep(e.target.value)} className="w-24" />
              <span className="text-sm text-muted-foreground">backups (older ones are deleted)</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={protect} onCheckedChange={(c) => setProtect(c === true)} aria-label="Protect with a password" />
              <Label className="font-normal">Protect with a password</Label>
            </div>
            {protect ? (
              <div className="grid gap-2">
                <div className="space-y-1">
                  <Label htmlFor="auto-password">{f.passwordSet ? "New password (leave empty to keep the current one)" : "Password"}</Label>
                  <Input id="auto-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  {f.passwordFromEnv && !password && (
                    <p className="text-xs text-muted-foreground">Now using BACKUP_PASSWORD from the stack&apos;s .env. Type one here to use your own instead.</p>
                  )}
                </div>
                {password && (
                  <div className="space-y-1">
                    <Label htmlFor="auto-password-confirm">Repeat the password</Label>
                    <Input id="auto-password-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Without this password a backup cannot be opened, by anyone. It is kept on the server in sealed form so a copy of the database never shows it.
                </p>
              </div>
            ) : (
              <p className="text-xs text-status-critical">Backups will be plain files that anyone with the folder can read.</p>
            )}
          </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-status-critical" data-testid="auto-backup-error">
              {error}
            </p>
          )}
          <DialogFooter>
            {auto.hasSaved && (
              <Button type="button" variant="ghost" disabled={pending} onClick={reset} className="sm:mr-auto" title="Forget what was saved here and use the stack's .env and the defaults">
                Reset to defaults
              </Button>
            )}
            <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && !editing && (
        <p role="alert" className="text-sm text-status-critical" data-testid="auto-backup-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="text-sm text-status-good" data-testid="auto-backup-note">
          {note}
        </p>
      )}
    </section>
  );
}
