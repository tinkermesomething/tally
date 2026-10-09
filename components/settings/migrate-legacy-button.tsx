"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { migrateLegacyDataAction } from "@/app/settings/users-actions";
import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";

/** One-time button: moves the original pre-multi-user database into YOUR
 * OWN new encrypted account. Only makes sense for whoever was using Tally
 * before this went multi-user - everyone else's account never had a
 * legacy file to begin with, so this is harmless (and a no-op) for them. */
export function MigrateLegacyButton() {
  const router = useRouter();
  const { currency } = useAppSettings();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: "migrated"; report: { table: string; rows: number; sumPence: number | null }[] } | { kind: "skipped"; reason: string } | { kind: "error"; error: string } | null
  >(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await migrateLegacyDataAction();
      if (!res.ok) setResult({ kind: "error", error: res.error });
      else if (!res.migrated) setResult({ kind: "skipped", reason: res.reason });
      else {
        setResult({ kind: "migrated", report: res.report });
        router.refresh();
      }
    } catch {
      setResult({ kind: "error", error: "The migration failed." });
    } finally {
      setBusy(false);
    }
  }

  const totalRows = result?.kind === "migrated" ? result.report.reduce((s, r) => s + r.rows, 0) : 0;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">Migrate legacy data</p>
      <p className="text-xs text-muted-foreground">
        If this account was using Tally before accounts were split up, this moves that old shared database into your own encrypted
        account - once. Safe to click again: once it&apos;s done, there&apos;s nothing left to migrate.
      </p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={run}>
        <DatabaseZap className="size-4 text-chart-1" />
        {busy ? "Migrating…" : "Migrate legacy data"}
      </Button>

      {result?.kind === "error" && (
        <p role="alert" className="text-sm text-status-critical">
          {result.error}
        </p>
      )}
      {result?.kind === "skipped" && <p className="text-sm text-muted-foreground">{result.reason}</p>}
      {result?.kind === "migrated" && (
        <div className="space-y-1 text-sm">
          <p className="text-status-good">Migrated {totalRows} rows across {result.report.length} tables. Check Grid/Reports match before deleting the old file.</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {result.report.map((r) => (
              <li key={r.table}>
                {r.table}: {r.rows} rows{r.sumPence !== null ? `, ${formatPence(r.sumPence, currency)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
