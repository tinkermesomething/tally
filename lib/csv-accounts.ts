import { accountDisplayName, accountLabels } from "@/lib/accounts";
import { CSV_PROVIDER, type getBankAccounts } from "@/lib/db/bank-sync";
import { parseSavedMappings } from "@/lib/csv-mappings";

/** What the Import CSV dialog needs to know about each account. */
export function toCsvAccounts(accounts: Awaited<ReturnType<typeof getBankAccounts>>) {
  const names = new Map(accountLabels(accounts).map((a) => [a.id, a.name]));
  return accounts.map((a) => {
    const { csv, pdf } = parseSavedMappings(a.csvMapping);
    return { id: a.id, name: names.get(a.id) ?? accountDisplayName(a), csvOnly: a.provider === CSV_PROVIDER, mapping: csv, pdfMapping: pdf };
  });
}
