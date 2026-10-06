"use client";

import { useRef, useState, useTransition } from "react";
import { Archive, Pencil, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { archiveLinkedBankAccount, renameBankAccount, syncBankAccountNow } from "@/app/settings/bank-sync-actions";
import { runAction } from "@/lib/action-result";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import type { RecentTransaction } from "@/lib/db/bank-sync";

export function BankAccountSettingsRow({
  id,
  displayName,
  alias = null,
  recent = [],
  provider,
  consentExpiresAt,
  lastSyncedAt,
}: {
  id: number;
  displayName: string;
  /** The user's own name for this account, if they set one. */
  alias?: string | null;
  /** The newest few transactions, so it is clear which account this is. */
  recent?: RecentTransaction[];
  provider: string;
  consentExpiresAt: string;
  lastSyncedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const { currency, dateFormat } = useAppSettings();
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);
  // Escape discards; the unmounting input may still fire blur in some browsers.
  const aliasCancelled = useRef(false);

  function saveAlias(next: string) {
    setEditingAlias(false);
    if (next.trim() === (alias ?? "")) return;
    setAliasError(null);
    startTransition(async () => {
      setAliasError(await runAction(() => renameBankAccount(id, next)));
    });
  }
  const expiresInDays = Math.ceil(
    (new Date(consentExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  );
  // CSV-only accounts have no bank connection: nothing expires, nothing syncs.
  const csvOnly = provider === "csv";
  const expiringSoon = !csvOnly && expiresInDays <= 14;

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
    <div className="space-y-2 row-card rounded-lg bg-card px-3 py-2">
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        {editingAlias ? (
          <input
            autoFocus
            defaultValue={alias ?? ""}
            maxLength={60}
            placeholder={displayName}
            aria-label="Account alias"
            onBlur={(e) => {
              if (aliasCancelled.current) {
                aliasCancelled.current = false;
                return;
              }
              saveAlias(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                aliasCancelled.current = true;
                setEditingAlias(false);
              }
            }}
            className="w-64 rounded-md border border-input bg-background px-1.5 py-0.5 font-medium outline-none focus:border-ring"
          />
        ) : (
          <span className="flex items-center gap-1.5 font-medium" data-testid="account-name">
            {alias || displayName}
            <button
              type="button"
              title="Give this account your own name"
              aria-label="Edit account alias"
              onClick={() => {
                aliasCancelled.current = false;
                setEditingAlias(true);
              }}
              className="rounded p-0.5 hover:bg-accent"
            >
              <Pencil className="size-3 text-chart-1" />
            </button>
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {alias ? `${displayName} · ` : ""}
          {csvOnly
            ? "CSV only · add transactions with Import CSV on the Review page"
            : `${provider} · last synced ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleDateString() : "never"}`}
        </span>
        {aliasError && <span className="text-xs text-status-critical">{aliasError}</span>}
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
        {!csvOnly && (
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={pending}
            title="Sync now"
            onClick={handleSync}
          >
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
          </Button>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title={csvOnly ? "Archive account (its transactions are kept)" : "Unlink"}
          onClick={() => startTransition(() => archiveLinkedBankAccount(id))}
        >
          <Archive className="size-3.5 text-chart-2" />
        </Button>
      </div>
    </div>
    <div className="border-t border-border/60 pt-1.5" data-testid="recent-transactions">
      <p className="mb-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">Last {recent.length || 5} transactions</p>
      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing imported yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {recent.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs" data-testid="recent-row">
              <span className="w-20 shrink-0 text-muted-foreground">{formatDate(t.bookingDate, dateFormat)}</span>
              <span className="min-w-0 flex-1 truncate">{t.payee}</span>
              <span className={cn("shrink-0 tabular-nums", t.amountPence > 0 && "text-status-good")}>
                {t.amountPence > 0 ? "+" : "−"}
                {formatPence(Math.abs(t.amountPence), currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
    </div>
  );
}
