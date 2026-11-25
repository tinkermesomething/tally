import { accountDisplayName, accountLabels } from "@/lib/accounts";
import { CSV_PROVIDER, type getBankAccounts } from "@/lib/db/bank-sync";
import { isCsvMapping, type CsvMapping } from "@/lib/csv-import";

/** What the Import CSV dialog needs to know about each account. */
export function toCsvAccounts(accounts: Awaited<ReturnType<typeof getBankAccounts>>) {
  const names = new Map(accountLabels(accounts).map((a) => [a.id, a.name]));
  return accounts.map((a) => {
    let mapping: CsvMapping | null = null;
    try {
      const parsed = a.csvMapping ? JSON.parse(a.csvMapping) : null;
      mapping = isCsvMapping(parsed) ? parsed : null;
    } catch {
      // a damaged saved mapping is ignored: the file is mapped fresh
    }
    return { id: a.id, name: names.get(a.id) ?? accountDisplayName(a), csvOnly: a.provider === CSV_PROVIDER, mapping };
  });
}
