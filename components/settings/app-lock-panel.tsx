"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/lib/action-result";
import { removeAppLockAction, setAppLockAction } from "@/app/settings/app-lock-actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/desktop/password-rules";

type Mode = "idle" | "set" | "remove";

/** Desktop only: an optional password asked for when Tally opens. Says in
 * plain words what it does and doesn't protect - it is not encryption. */
export function AppLockPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function reset(message: string | null = null) {
    setMode("idle");
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setDone(message);
  }

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    const err = await runAction(fn);
    setBusy(false);
    if (err) return setError(err);
    reset(message);
    router.refresh();
  }

  const mismatch = confirm.length > 0 && next !== confirm;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Asks for a password when Tally opens. It keeps people at your unlocked computer out of your budget. It does not change how your
        data is encrypted, and it can&apos;t stop software already running as you. Forgot it? Delete <code>app-lock.json</code> in
        Tally&apos;s data folder - your data is not affected.
      </p>

      {mode === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 text-sm">
            {enabled ? <Lock className="size-4 text-status-good" /> : <LockOpen className="size-4 text-muted-foreground" />}
            {enabled ? "App lock is on." : "App lock is off."}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => setMode("set")}>
            {enabled ? "Change password" : "Set a password"}
          </Button>
          {enabled && (
            <>
              {/* A full navigation to a route that swaps the cookie - not a server action, see that route's comment. */}
              <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign("/api/desktop/lock")}>
                Lock now
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMode("remove")}>
                Turn off
              </Button>
            </>
          )}
        </div>
      )}

      {mode === "set" && (
        <div className="grid max-w-sm gap-2">
          {enabled && (
            <div className="space-y-1">
              <Label htmlFor="lock-current">Current password</Label>
              <Input id="lock-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="lock-new">New password ({MIN_PASSWORD_LENGTH}+ characters)</Label>
            <Input id="lock-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lock-confirm">Repeat new password</Label>
            <Input id="lock-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          {mismatch && <p className="text-sm text-status-critical">The two passwords don&apos;t match.</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !next || next !== confirm || (enabled && !current)}
              onClick={() => run(() => setAppLockAction(next, current), enabled ? "Password changed." : "App lock is on. It asks for the password next time Tally opens.")}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "remove" && (
        <div className="grid max-w-sm gap-2">
          <div className="space-y-1">
            <Label htmlFor="lock-remove">Current password</Label>
            <Input id="lock-remove" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !current} onClick={() => run(() => removeAppLockAction(current), "App lock is off.")}>
              {busy ? "Turning off…" : "Turn off app lock"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}
      {done && !error && <p className="text-sm text-status-good">{done}</p>}
    </div>
  );
}
