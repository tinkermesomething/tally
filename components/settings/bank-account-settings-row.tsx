"use client";

import { useState, useTransition } from "react";
import { Archive, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { archiveLinkedBankAccount, syncBankAccountNow } from "@/app/settings/bank-sync-actions";

export function BankAccountSettingsRow({
  id,
  displayName,
  provider,
  consentExpiresAt,
  lastSyncedAt,
}: {
  id: number;
  displayName: string;
  provider: string;
  consentExpiresAt: string;
  lastSyncedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const expiresInDays = Math.ceil(
    (new Date(consentExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  );
  const expiringSoon = expiresInDays <= 14;

  function handleSync() {
    setSyncResult(null);
    startTransition(async () => {
      try {
        const { staged } = await syncBankAccountNow(id);
        setSyncResult(staged === 0 ? "Up to date" : `${staged} new`);
      } catch (err) {
        setSyncResult(err instanceof Error ? err.message : "Sync failed");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex flex-col">
        <span className="font-medium">{displayName}</span>
        <span className="text-xs text-muted-foreground">
          {provider} · last synced {lastSyncedAt ? new Date(lastSyncedAt).toLocaleDateString() : "never"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {syncResult && (
          <span className="text-xs text-muted-foreground">{syncResult}</span>
        )}
        {expiringSoon && (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
              expiresInDays < 0
                ? "bg-status-critical/15 text-status-critical"
                : "bg-status-warning/15 text-status-warning"
            )}
          >
            <TriangleAlert className="size-3" />
            {expiresInDays < 0 ? "Access expired - reconnect" : `Expires in ${expiresInDays}d`}
          </span>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title="Sync now"
          onClick={handleSync}
        >
          <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title="Unlink"
          onClick={() => startTransition(() => archiveLinkedBankAccount(id))}
        >
          <Archive className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
