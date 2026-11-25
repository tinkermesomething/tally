"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ImportCsvDialog, type CsvAccountOption, type CsvPreload } from "@/components/review/import-csv-dialog";
import { checkIngestNow, loadIngestFile, saveIngestSettings } from "@/app/settings/ingest-actions";

export type IngestView = {
  desktop: boolean;
  on: boolean;
  /** Where files are looked for; null = nothing set up. */
  dir: string | null;
  /** Desktop: what is saved, and a starting suggestion. */
  savedDir: string | null;
  suggestion: string | null;
  /** Why there is no folder, when that is a fault. */
  problem: string | null;
  folder: "unset" | "missing" | "ok";
  ready: number;
  waiting: { folder: string; name: string; reason: string; setup?: { accountId: number | null } }[];
  strays: string[];
  recent: { bucket: "processed" | "failed"; folder: string; name: string; at: string; reason: string | null }[];
};

/** Settings > Account settings > Ingest folder. Drop a CSV in
 * <folder>/<account name>/ and Tally imports it (see lib/ingest.ts). */
export function IngestPanel({ view, accounts }: { view: IngestView; accounts: CsvAccountOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(view.on);
  const [dir, setDir] = useState(view.savedDir ?? view.suggestion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [setup, setSetup] = useState<CsvPreload | null>(null);

  function save(enabled: boolean, nextDir?: string) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await saveIngestSettings({ enabled, dir: nextDir });
      if (!res.ok) {
        setOn(view.on);
        return setError(res.error);
      }
      setOn(enabled);
      setNote("Saved.");
      router.refresh();
    });
  }

  function check() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await checkIngestNow();
      if (!res.ok) return setError(res.error);
      setNote(res.message);
      router.refresh();
    });
  }

  /** Opens the import dialog with a waiting file in it, so the person confirms the account and columns once. */
  function openSetup(w: IngestView["waiting"][number]) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await loadIngestFile(w.folder, w.name);
      if (!res.ok) return setError(res.error);
      setSetup({ folder: w.folder, name: w.name, text: res.text, accountId: w.setup?.accountId ?? null, kind: res.kind, summary: res.summary });
    });
  }

  const usable = view.folder === "ok";

  return (
    <div className="space-y-3" data-testid="ingest">
      <p className="text-xs text-muted-foreground">
        Drop a bank CSV or PDF statement into a subfolder named after the account (for example <code className="rounded bg-muted px-1">Revolut</code>), and Tally imports it. The first file for a new account waits here: click Set up, check the columns once, and Tally takes the rest by itself.
        {view.desktop ? " Tally checks when the app opens, and when you click Check now." : " Tally checks every 15 minutes, and when you click Check now."}
      </p>

      {view.desktop ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Full path of the folder to watch" aria-label="Ingest folder" className="min-w-0 flex-1" />
            <Button type="button" size="sm" variant="outline" disabled={pending || !dir.trim()} onClick={() => save(true, dir)}>
              {view.savedDir ? "Save folder" : "Create folder and switch on"}
            </Button>
          </div>
          {!view.savedDir && <p className="text-xs text-muted-foreground">Tally makes this folder if it isn&apos;t there. Then make one subfolder inside it for each account.</p>}
        </div>
      ) : (
        <p className="text-sm" data-testid="ingest-dir">
          {view.dir ? (
            <>
              Your folder: <code className="rounded bg-muted px-1">{view.dir}</code>
            </>
          ) : (
            <span className="text-muted-foreground">{view.problem ?? "Your administrator hasn't set up an ingest folder on this server."}</span>
          )}
        </p>
      )}

      {view.dir && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm">Import files from the folder</p>
            <p className="text-xs text-muted-foreground" data-testid="ingest-state">
              {!on ? (
                <span className="font-medium">Off</span>
              ) : view.folder === "missing" ? (
                <span className="font-medium text-status-critical">The folder doesn&apos;t exist{view.desktop ? " yet. Save it to create it." : ". Ask your administrator to create it."}</span>
              ) : (
                <>
                  <span className="font-medium text-status-good">On</span> · {view.ready} ready · {view.waiting.length + view.strays.length} waiting
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={pending || !on || !usable} onClick={check}>
              Check now
            </Button>
            <Switch checked={on} disabled={pending} onCheckedChange={(next) => save(next, view.desktop ? dir : undefined)} aria-label="Import files from the folder" />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      )}

      {usable && (view.waiting.length > 0 || view.strays.length > 0) && (
        <div className="space-y-1" data-testid="ingest-waiting">
          <p className="text-xs font-medium">Waiting for you</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {view.strays.map((name) => (
              <li key={`stray-${name}`}>
                <span className="font-medium text-foreground">{name}</span>: it is in the main folder. Move it into a subfolder named after its account{view.dir ? `, for example ${view.dir.replace(/[\\/]$/, "")}${view.dir.includes("\\") ? "\\" : "/"}Revolut` : ""}. If this folder is itself the account&apos;s folder, set the ingest folder one level up.
              </li>
            ))}
            {view.waiting.map((w) => (
              <li key={`${w.folder}/${w.name}`}>
                <span className="font-medium text-foreground">
                  {w.folder}/{w.name}
                </span>
                : {w.reason}
                {w.setup && (
                  <Button type="button" size="sm" variant="outline" className="ml-2 h-6 px-2 text-xs" disabled={pending} onClick={() => openSetup(w)}>
                    {w.setup.accountId === null ? `Create "${w.folder}" and set up` : "Set up"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {usable && view.recent.length > 0 && (
        <div className="space-y-1" data-testid="ingest-recent">
          <p className="text-xs font-medium">Recent files</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {view.recent.map((r) => (
              <li key={`${r.bucket}/${r.folder}/${r.at}/${r.name}`}>
                <span className={r.bucket === "failed" ? "font-medium text-status-critical" : "font-medium text-status-good"}>{r.bucket === "failed" ? "Failed" : "Imported"}</span> · {r.folder}/{r.name} · {r.at}
                {r.reason && <span className="block pl-3">{r.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {setup && (
        <ImportCsvDialog
          accounts={accounts}
          preload={setup}
          onClose={(imported) => {
            setSetup(null);
            // The file is now imported by hand; a check files it away and takes anything else waiting.
            if (imported) check();
          }}
        />
      )}
    </div>
  );
}
