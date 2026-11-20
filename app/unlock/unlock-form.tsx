"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unlockAction, type UnlockState } from "./actions";

export function UnlockForm() {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockAction, { error: null });
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="unlock-password">Password</Label>
        <Input id="unlock-password" name="password" type="password" autoComplete="current-password" autoFocus required />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-status-critical">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Unlocking…" : "Unlock"}
      </Button>
    </form>
  );
}
