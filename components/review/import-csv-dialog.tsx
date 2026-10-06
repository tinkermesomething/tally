"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DELIMITERS, detectDelimiter, type Delimiter } from "@/lib/csv";
import { guessMapping, mapCsvRows, splitTable, type CsvMapping } from "@/lib/csv-import";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/date-format";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { importCsv, previewCsv } from "@/app/review/csv-actions";
import type { CsvImportPlan, CsvImportResult, DuplicatePolicy } from "@/lib/db/csv-import";

export type CsvAccountOption = { id: number; name: string; csvOnly: boolean; mapping: CsvMapping | null };

const NEW_ACCOUNT = "new";
const MAX_BYTES = 8 * 1024 * 1024;
const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

const colLabel = (headers: string[], i: number) => (headers[i] ? `${i + 1}: ${headers[i]}` : `Column ${i + 1}`);

/** Import a bank's CSV export from the browser. The file never leaves the
 * page until you press Import: it is read and mapped here, with a live
 * preview of exactly what will be imported. */
export function ImportCsvDialog({ accounts }: { accounts: CsvAccountOption[] }) {
  const router = useRouter();
  const { currency, dateFormat } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string>(accounts[0] ? String(accounts[0].id) : NEW_ACCOUNT);
  const [newName, setNewName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [policy, setPolicy] = useState<DuplicatePolicy>("flag");
  const [plan, setPlan] = useState<CsvImportPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const planRequest = useRef(0);

  const account = accounts.find((a) => String(a.id) === accountId) ?? null;

  function reset() {
    setAccountId(accounts[0] ? String(accounts[0].id) : NEW_ACCOUNT);
    setNewName("");
    setFileName(null);
    setText(null);
    setMapping(null);
    setPolicy("flag");
    setPlan(null);
    setPlanError(null);
    setResult(null);
    setError(null);
  }

  /** The account's saved mapping when this file looks like the same layout
   * (same header row); otherwise a fresh guess. */
  function chooseMapping(content: string, acct: CsvAccountOption | null): CsvMapping {
    const delimiter = detectDelimiter(content);
    const saved = acct?.mapping;
    if (saved) {
      const probe = splitTable(content, { ...saved });
      if (!saved.hasHeader || probe.headers.length > 0) {
        const check = mapCsvRows(content, saved);
        if (check.rows.length > 0 && check.errors.length <= check.rows.length) return saved;
      }
    }
    return guessMapping(content, delimiter);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPlan(null);
    if (file.size > MAX_BYTES) return setError("That file is over 8 MB. Split it and import in parts.");
    const content = await file.text();
    if (!content.trim()) return setError("That file is empty.");
    setFileName(file.name);
    setText(content);
    setMapping(chooseMapping(content, account));
  }

  // Changing the account may bring a saved mapping for the already-loaded file.
  useEffect(() => {
    if (text !== null) setMapping(chooseMapping(text, account));
    // only when the account changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const mapped = useMemo(() => (text !== null && mapping ? mapCsvRows(text, mapping) : null), [text, mapping]);
  const table = useMemo(() => (text !== null && mapping ? splitTable(text, mapping) : null), [text, mapping]);
  const columns = table?.columns ?? 0;
  const headers = table?.headers ?? [];

  // Live "what would happen" from the server, debounced, newest answer wins.
  const rowsKey = mapped ? `${mapped.rows.length}|${mapped.rows[0]?.bookingDate}|${mapped.rows.at(-1)?.amountPence}|${accountId}` : "";
  useEffect(() => {
    if (!mapped || mapped.rows.length === 0) {
      setPlan(null);
      setPlanError(null);
      return;
    }
    const id = ++planRequest.current;
    const timer = setTimeout(async () => {
      const res = await previewCsv({
        accountId: accountId === NEW_ACCOUNT ? null : parseInt(accountId, 10),
        transactions: mapped.rows.map(({ bookingDate, amountPence, payeeRaw, idHint }) => ({ bookingDate, amountPence, payeeRaw, idHint })),
      });
      if (id !== planRequest.current) return;
      if (res.ok) {
        setPlan(res.plan);
        setPlanError(null);
      } else {
        setPlan(null);
        setPlanError(res.error);
      }
    }, 350);
    return () => clearTimeout(timer);
    // rowsKey summarizes the parsed rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey]);

  const set = (patch: Partial<CsvMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));

  function submit() {
    if (!mapped || !mapping) return;
    if (accountId === NEW_ACCOUNT && !newName.trim()) return setError("Give the new account a name.");
    setError(null);
    startTransition(async () => {
      const res = await importCsv({
        accountId: accountId === NEW_ACCOUNT ? null : parseInt(accountId, 10),
        newAccountName: newName,
        transactions: mapped.rows.map(({ bookingDate, amountPence, payeeRaw, idHint }) => ({ bookingDate, amountPence, payeeRaw, idHint })),
        duplicatePolicy: policy,
        mapping,
      });
      if (!res.ok) return setError(res.error);
      setResult(res.result);
    });
  }

  const importable = plan ? (policy === "skip" ? plan.fresh - plan.possibleDuplicates : plan.fresh) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          const imported = result !== null;
          reset();
          if (imported) router.refresh();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <FileUp className="size-4 text-chart-1" />
            Import CSV
          </Button>
        }
      />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {result ? (
          <div className="space-y-3" data-testid="csv-result">
            <DialogHeader>
              <DialogTitle>Imported {result.imported} {result.imported === 1 ? "transaction" : "transactions"}</DialogTitle>
              <DialogDescription>
                {result.categorized} filed by your rules, {result.ignored} ignored, {result.waitingInReview} waiting in Review.
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {result.alreadyImported > 0 && <li>{result.alreadyImported} were already imported and skipped.</li>}
              {result.skippedPossibleDuplicates > 0 && <li>{result.skippedPossibleDuplicates} possible duplicates were skipped.</li>}
              {result.possibleDuplicates - result.skippedPossibleDuplicates > 0 && (
                <li>{result.possibleDuplicates - result.skippedPossibleDuplicates} look like existing transactions. They are in Review with a warning triangle.</li>
              )}
            </ul>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Import transactions from a CSV</DialogTitle>
              <DialogDescription>Pick the account, choose the file, and check the columns. Nothing is saved until you press Import.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="csv-account">Account</Label>
                <select id="csv-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.csvOnly ? " (CSV only)" : ""}
                    </option>
                  ))}
                  <option value={NEW_ACCOUNT}>New CSV-only account…</option>
                </select>
                {accountId === NEW_ACCOUNT && (
                  <Input aria-label="New account name" placeholder="e.g. Old credit card" value={newName} onChange={(e) => setNewName(e.target.value)} />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="csv-file">CSV file</Label>
                <input
                  id="csv-file"
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  onChange={onFile}
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-sm"
                />
                {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
              </div>
            </div>

            {mapping && mapped && table && (
              <>
                <div className="space-y-3 rounded-lg border border-border p-3" data-testid="csv-mapping">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="csv-delim">Separator</Label>
                      <select id="csv-delim" className={selectClass} value={mapping.delimiter} onChange={(e) => text !== null && setMapping(guessMapping(text, e.target.value as Delimiter))}>
                        {DELIMITERS.map((d) => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="csv-skip">Lines to skip at the top</Label>
                      <Input id="csv-skip" type="number" min={0} max={50} className="w-24" value={mapping.skipRows} onChange={(e) => set({ skipRows: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                    </div>
                    <label className="flex items-center gap-2 pb-1.5 text-sm">
                      <Checkbox checked={mapping.hasHeader} onCheckedChange={(c) => set({ hasHeader: c === true })} aria-label="First line is column names" />
                      First line is column names
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="csv-date">Date column</Label>
                      <select id="csv-date" className={selectClass} value={mapping.dateCol} onChange={(e) => set({ dateCol: parseInt(e.target.value, 10) })}>
                        {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{colLabel(headers, i)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="csv-datefmt">Dates like 03/04/2026 mean</Label>
                      <select id="csv-datefmt" className={selectClass} value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as CsvMapping["dateFormat"] })}>
                        <option value="dmy">3 April (day first)</option>
                        <option value="mdy">March 4 (month first)</option>
                        <option value="ymd">Year first</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="csv-id">Bank&apos;s own ID column (optional)</Label>
                      <select id="csv-id" className={selectClass} value={mapping.idCol ?? ""} onChange={(e) => set({ idCol: e.target.value === "" ? null : parseInt(e.target.value, 10) })}>
                        <option value="">None</option>
                        {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{colLabel(headers, i)}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="font-medium">Amount</span>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name="csv-amount-mode" checked={mapping.amountMode === "single"} onChange={() => set({ amountMode: "single" })} />
                        One column (negative = money out)
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name="csv-amount-mode" checked={mapping.amountMode === "split"} onChange={() => set({ amountMode: "split" })} />
                        Separate money in / out columns
                      </label>
                    </div>
                    {mapping.amountMode === "single" ? (
                      <select aria-label="Amount column" className={selectClass} value={mapping.amountCol} onChange={(e) => set({ amountCol: parseInt(e.target.value, 10) })}>
                        {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{colLabel(headers, i)}</option>)}
                      </select>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <select aria-label="Money in column" className={selectClass} value={mapping.inCol} onChange={(e) => set({ inCol: parseInt(e.target.value, 10) })}>
                          {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>In: {colLabel(headers, i)}</option>)}
                        </select>
                        <select aria-label="Money out column" className={selectClass} value={mapping.outCol} onChange={(e) => set({ outCol: parseInt(e.target.value, 10) })}>
                          {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>Out: {colLabel(headers, i)}</option>)}
                        </select>
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={mapping.flipSign} onCheckedChange={(c) => set({ flipSign: c === true })} aria-label="Spending shows as positive" />
                      This file shows spending as positive numbers (flip the sign)
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">Payee text from (tick one or more)</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {Array.from({ length: columns }, (_, i) => (
                        <label key={i} className="flex items-center gap-1.5 text-sm">
                          <Checkbox
                            checked={mapping.payeeCols.includes(i)}
                            aria-label={`Payee from ${colLabel(headers, i)}`}
                            onCheckedChange={(c) => set({ payeeCols: c === true ? [...mapping.payeeCols, i].sort((a, b) => a - b) : mapping.payeeCols.filter((x) => x !== i) })}
                          />
                          {colLabel(headers, i)}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2" data-testid="csv-preview">
                  <p className="text-sm font-medium">
                    {mapped.rows.length} {mapped.rows.length === 1 ? "row" : "rows"} read
                    {mapped.errors.length > 0 && <span className="text-status-critical"> · {mapped.errors.length} can&apos;t be read</span>}
                  </p>
                  {mapped.rows.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <tbody>
                          {mapped.rows.slice(0, 5).map((r) => (
                            <tr key={r.line} className="row-line border-b border-border last:border-0" data-testid="csv-preview-row">
                              <td className="whitespace-nowrap px-2 py-1 text-xs text-muted-foreground">{formatDate(r.bookingDate, dateFormat)}</td>
                              <td className="max-w-xs truncate px-2 py-1">{r.payeeRaw}</td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                                {r.amountPence > 0 ? "+" : "−"}
                                {formatPence(Math.abs(r.amountPence), currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {mapped.errors.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" data-testid="csv-errors">
                      {mapped.errors.slice(0, 4).map((er) => (
                        <li key={er.line}>Line {er.line}: {er.reason}</li>
                      ))}
                      {mapped.errors.length > 4 && <li>…and {mapped.errors.length - 4} more. Rows that can&apos;t be read are left out.</li>}
                    </ul>
                  )}
                </div>

                {plan && (
                  <div className="space-y-2 rounded-lg border border-border bg-secondary p-3 text-sm" data-testid="csv-plan">
                    <p>
                      <span className="font-medium">{plan.fresh} new</span>
                      {plan.alreadyImported > 0 && <> · {plan.alreadyImported} already imported</>}
                      {plan.possibleDuplicates > 0 && <> · <span className="text-chart-4">{plan.possibleDuplicates} look like existing transactions</span></>}
                      {plan.oldest && plan.newest && <span className="text-muted-foreground"> · {formatDate(plan.oldest, dateFormat)} to {formatDate(plan.newest, dateFormat)}</span>}
                    </p>
                    {plan.possibleDuplicates > 0 && (
                      <div className="space-y-1">
                        <label className="flex items-center gap-2">
                          <input type="radio" name="csv-dupes" checked={policy === "flag"} onChange={() => setPolicy("flag")} />
                          Import them and flag them in Review
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="radio" name="csv-dupes" checked={policy === "skip"} onChange={() => setPolicy("skip")} />
                          Skip them
                        </label>
                      </div>
                    )}
                  </div>
                )}
                {planError && <p className="text-sm text-status-critical">{planError}</p>}
              </>
            )}

            {error && <p className="text-sm text-status-critical">{error}</p>}
            <DialogFooter>
              <Button disabled={pending || !plan || importable === 0} onClick={submit}>
                {pending ? "Importing…" : `Import ${importable} ${importable === 1 ? "transaction" : "transactions"}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
