import { formatSyncTime, syncSlotHours, syncTimeZone } from "@/lib/sync-schedule";
import {
  getCategoryTree,
  getIncomeSourceList,
  getArchivedCategories,
  getArchivedIncomeSources,
} from "@/lib/db/queries";
import { getPeopleWithBalances, getArchivedPeople } from "@/lib/db/debt";
import { getBuckets } from "@/lib/db/savings";
import { bucketColor } from "@/lib/savings-math";
import { getAppSettings } from "@/lib/db/settings";
import { getBankAccounts, getCategoryRules, getRecentTransactions } from "@/lib/db/bank-sync";
import { ruleConditionsOf } from "@/lib/rules";
import { accountLabels } from "@/lib/accounts";
import { buildGroupColorMap, GROUP_PALETTE, UNGROUPED } from "@/lib/group-colors";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AddCategoryDialog } from "@/components/grid/add-category-dialog";
import { AddIncomeSourceDialog } from "@/components/grid/add-income-source-dialog";
import { AddPersonDialog } from "@/components/debt/add-person-dialog";
import { CategorySettingsRow } from "@/components/settings/category-settings-row";
import { IncomeSourceSettingsRow } from "@/components/settings/income-source-settings-row";
import { PersonSettingsRow } from "@/components/settings/person-settings-row";
import { PreferencesSettings } from "@/components/settings/preferences-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import type { AutoBackupView } from "@/components/settings/auto-backup-panel";
import { describeSchedule } from "@/lib/auto-backup-settings";
import { autoBackupStatus } from "@/lib/auto-backup";
import { BankAccountSettingsRow } from "@/components/settings/bank-account-settings-row";
import { CategoryRuleSettingsRow } from "@/components/settings/category-rule-settings-row";
import { AddCategoryRuleDialog } from "@/components/settings/add-category-rule-dialog";
import { ConnectBankAccountDialog } from "@/components/settings/connect-bank-account-dialog";
import { BankSyncSchedule } from "@/components/settings/bank-sync-schedule";
import { ArchivedList } from "@/components/settings/archived-list";
import { FilterableList } from "@/components/settings/filterable-list";
import {
  unarchiveCategory,
  unarchiveIncomeSource,
} from "@/app/grid/actions";
import { restorePerson } from "@/app/debt/actions";

export const dynamic = "force-dynamic";

// Tab order as shown. `?tab=` can open any of them directly (the bank
// connection callback uses ?tab=bank-sync).
const SETTINGS_TABS = ["categories", "income", "lenders", "rules", "bank-sync", "preferences", "backup"];
// The tab used to be called "people" - old links and bookmarks still open it.
const TAB_ALIASES: Record<string, string> = { people: "lenders" };

// Amounts are stored as pence; forms and the list show pounds.
const displayConditions = (r: Parameters<typeof ruleConditionsOf>[0]) =>
  ruleConditionsOf(r).map((c) => ({
    field: c.field,
    operator: c.operator,
    value: c.field === "amount" ? (parseInt(c.value, 10) / 100).toFixed(2) : c.value,
  }));

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; connected?: string; bankSyncError?: string }>;
}) {
  const { tab, connected, bankSyncError } = await searchParams;
  const [
    categoryTree,
    incomeSources,
    people,
    archivedCategories,
    archivedIncomeSources,
    archivedPeople,
    appSettings,
    bankAccounts,
    categoryRules,
    savingsBuckets,
  ] = await Promise.all([
    getCategoryTree(),
    getIncomeSourceList(),
    getPeopleWithBalances(),
    getArchivedCategories(),
    getArchivedIncomeSources(),
    getArchivedPeople(),
    getAppSettings(),
    getBankAccounts(),
    getCategoryRules(),
    getBuckets(),
  ]);
  const recentByAccount = await getRecentTransactions(bankAccounts.map((a) => a.id), 5);
  const buckets = savingsBuckets.map((b) => ({ id: b.id, name: b.name, color: bucketColor(b) }));
  const bucketNameById = new Map(buckets.map((b) => [b.id, b.name]));

  const groupColors = buildGroupColorMap(categoryTree);
  const existingGroups = Array.from(
    new Set(categoryTree.map((c) => c.groupName).filter((g): g is string => !!g))
  );

  const flatCategories = categoryTree.flatMap((c) => [
    { id: c.id, name: c.name },
    ...c.children.map((child) => ({ id: child.id, name: `${c.name} — ${child.name}` })),
  ]);
  const categoryNameById = new Map(flatCategories.map((c) => [c.id, c.name]));
  const personNameById = new Map(people.map((p) => [p.id, p.name]));
  const accounts = accountLabels(bankAccounts);
  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name]));
  const incomeSourceNameById = new Map(incomeSources.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Tabs defaultValue={SETTINGS_TABS.includes(TAB_ALIASES[tab ?? ""] ?? tab ?? "") ? (TAB_ALIASES[tab ?? ""] ?? tab!) : "categories"}>
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="lenders">Lenders</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="bank-sync">Bank sync</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Rename, regroup, add subcategories, or archive. Press and hold a name to drag it into place.
            </p>
            <AddCategoryDialog
              topLevelCategories={categoryTree.map((c) => ({ id: c.id, name: c.name }))}
              existingGroups={existingGroups}
            />
          </div>

          <FilterableList
            label="categories"
            placeholder="Search categories, subcategories or groups"
            items={categoryTree.map((category) => ({
              key: category.id,
              // A parent row shows its subcategories, so it matches on them too.
              texts: [
                category.name,
                category.groupName,
                category.linkedDebtPersonId ? personNameById.get(category.linkedDebtPersonId) : null,
                category.linkedBucketId ? bucketNameById.get(category.linkedBucketId) : null,
                ...category.children.flatMap((child) => [
                  child.name,
                  child.linkedDebtPersonId ? personNameById.get(child.linkedDebtPersonId) : null,
                  child.linkedBucketId ? bucketNameById.get(child.linkedBucketId) : null,
                ]),
              ],
              node: (
                <CategorySettingsRow
                  category={category}
                  color={groupColors.get(category.groupName ?? UNGROUPED)!}
                  buckets={buckets}
                  existingGroups={existingGroups}
                  topLevelCategories={categoryTree.map((c) => ({ id: c.id, name: c.name }))}
                  people={people.map((p) => ({ id: p.id, name: p.name }))}
                />
              ),
            }))}
          />

          {archivedCategories.length > 0 && (
            <div className="pt-2">
              <h2 className="pb-1 text-sm font-medium text-muted-foreground">Archived</h2>
              <ArchivedList
                items={archivedCategories}
                restoreAction={unarchiveCategory}
                emptyLabel="No archived categories."
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="income" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Add, rename, reorder (press and hold) or archive income sources.</p>
            <AddIncomeSourceDialog />
          </div>

          <div className="space-y-2">
            {incomeSources.map((source, index) => (
              <IncomeSourceSettingsRow
                key={source.id}
                id={source.id}
                name={source.name}
                isPayAnchor={source.isPayAnchor}
                color={source.color}
                fallbackColor={GROUP_PALETTE[index % GROUP_PALETTE.length]}
              />
            ))}
          </div>

          {archivedIncomeSources.length > 0 && (
            <div className="pt-2">
              <h2 className="pb-1 text-sm font-medium text-muted-foreground">Archived</h2>
              <ArchivedList
                items={archivedIncomeSources}
                restoreAction={unarchiveIncomeSource}
                emptyLabel="No archived income sources."
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="lenders" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Add or archive lenders (people or companies) tracked in the debt ledger.
            </p>
            <AddPersonDialog />
          </div>

          <div className="space-y-2">
            {people.map((person) => (
              <PersonSettingsRow key={person.id} person={person} />
            ))}
          </div>

          {archivedPeople.length > 0 && (
            <div className="pt-2">
              <h2 className="pb-1 text-sm font-medium text-muted-foreground">Archived</h2>
              <ArchivedList
                items={archivedPeople}
                restoreAction={restorePerson}
                emptyLabel="No archived lenders."
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="rules" className="space-y-4 pt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Auto-categorization rules</h2>
                <p className="text-xs text-muted-foreground">
                  Runs automatically when a transaction imports - first match wins.
                </p>
              </div>
              <AddCategoryRuleDialog
                categories={flatCategories}
                incomeSources={incomeSources.map((s) => ({ id: s.id, name: s.name }))}
                people={people.map((p) => ({ id: p.id, name: p.name }))}
                accounts={accounts}
                buckets={buckets.map((b) => ({ id: b.id, name: b.name }))}
              />
            </div>
            {categoryRules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rules yet.</p>
            ) : (
              <FilterableList
                label="rules"
                placeholder="Search rules by payee, amount, account or category"
                items={categoryRules.map((r) => {
                  const conditions = displayConditions(r).map((c) =>
                    c.field === "account" ? { ...c, value: accountNameById.get(c.value) ?? "an unlinked account" } : c
                  );
                  const targetName =
                    r.targetType === "ignore"
                      ? "Ignore"
                      : r.targetType === "income"
                        ? (incomeSourceNameById.get(r.incomeSourceId!) ?? "Unknown income source")
                        : (categoryNameById.get(r.categoryId!) ?? "Unknown category");
                  const debtPersonName = r.debtPersonId ? (personNameById.get(r.debtPersonId) ?? null) : null;
                  const savingsBucketName = r.savingsBucketId ? (bucketNameById.get(r.savingsBucketId) ?? "a removed bucket") : null;
                  return {
                    key: r.id,
                    texts: [...conditions.map((c) => c.value), targetName, debtPersonName, savingsBucketName],
                    node: (
                      <CategoryRuleSettingsRow
                        id={r.id}
                        editor={
                          <AddCategoryRuleDialog
                            categories={flatCategories}
                            incomeSources={incomeSources.map((s) => ({ id: s.id, name: s.name }))}
                            people={people.map((p) => ({ id: p.id, name: p.name }))}
                            accounts={accounts}
                            buckets={buckets.map((b) => ({ id: b.id, name: b.name }))}
                            rule={{
                              id: r.id,
                              conditions: displayConditions(r),
                              targetType: r.targetType,
                              categoryId: r.categoryId,
                              incomeSourceId: r.incomeSourceId,
                              debtPersonId: r.debtPersonId,
                              savingsBucketId: r.savingsBucketId,
                            }}
                          />
                        }
                        conditions={conditions}
                        targetName={targetName}
                        debtPersonName={debtPersonName}
                        savingsBucketName={savingsBucketName}
                        debtKind={r.targetType === "income" ? "loan" : "repayment"}
                    targetKind={r.targetType}
                      />
                    ),
                  };
                })}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="bank-sync" className="space-y-6 pt-4">
          {connected && (
            <p className="rounded-lg border border-status-good/30 bg-status-good/10 px-3 py-2 text-sm text-status-good">
              Connected {connected} account{connected === "1" ? "" : "s"}.
            </p>
          )}
          {bankSyncError && (
            <p className="rounded-lg border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-sm text-status-critical">
              Connection failed: {bankSyncError}. Try again, or check the bank wasn&apos;t
              closed partway through.
            </p>
          )}

          <BankSyncSchedule
            enabled={appSettings.bankSyncEnabled}
            frequencyHours={appSettings.bankSyncFrequencyHours}
            slotLabel={Object.fromEntries(
              [6, 12, 24].map((h) => [h, `${syncSlotHours(h).map((x) => `${String(x).padStart(2, "0")}:00`).join(", ")} (${syncTimeZone()})`])
            )}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Linked accounts</h2>
              <ConnectBankAccountDialog />
            </div>
            {bankAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bank accounts linked yet.</p>
            ) : (
              <div className="space-y-2">
                {bankAccounts.map((a) => (
                  <BankAccountSettingsRow
                    key={a.id}
                    id={a.id}
                    displayName={a.displayName}
                    alias={a.alias}
                    recent={recentByAccount.get(a.id) ?? []}
                    provider={a.provider}
                    consentExpiresAt={a.consentExpiresAt.toString()}
                    lastSyncedAt={a.lastSyncedAt ? a.lastSyncedAt.toString() : null}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="preferences" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">Display preferences for the whole app.</p>
          <PreferencesSettings
            currency={appSettings.currency}
            dateFormat={appSettings.dateFormat}
            carryOverStartYear={appSettings.carryOverStartYear}
            carryOverStartMonth={appSettings.carryOverStartMonth}
          />
        </TabsContent>

        <TabsContent value="backup" className="space-y-4 pt-4">
          <BackupSettings auto={await autoBackupView()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** What the Backup tab shows about the automatic backups, already formatted
 * (times in the app's time zone, so the browser's own zone can't disagree). */
async function autoBackupView(): Promise<AutoBackupView> {
  const s = await autoBackupStatus();
  const common = { paused: s.paused, form: s.form, envDir: s.envDir, hasSaved: s.hasSaved };
  if (!s.enabled) {
    return { ...common, enabled: false, dir: null, protected: false, when: null, next: null, total: 0, writable: true, problem: null, lastError: null, files: [] };
  }
  return {
    ...common,
    enabled: true,
    dir: s.dir,
    protected: s.protected,
    when: describeSchedule(s, s.timeZone),
    next: s.due ? null : formatSyncTime(s.nextAt),
    total: s.total,
    writable: s.writable,
    problem: s.problem,
    lastError: s.lastError,
    files: s.files.map((f) => ({ name: f.name, size: f.size, at: formatSyncTime(f.modifiedAt) })),
  };
}
