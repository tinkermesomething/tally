import {
  getCategoryTree,
  getIncomeSourceList,
  getArchivedCategories,
  getArchivedIncomeSources,
} from "@/lib/db/queries";
import { getPeopleWithBalances, getArchivedPeople } from "@/lib/db/debt";
import { getAppSettings } from "@/lib/db/settings";
import { getBankAccounts, getCategoryRules } from "@/lib/db/bank-sync";
import { buildGroupColorMap, UNGROUPED } from "@/lib/group-colors";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AddCategoryDialog } from "@/components/grid/add-category-dialog";
import { AddIncomeSourceDialog } from "@/components/grid/add-income-source-dialog";
import { AddPersonDialog } from "@/components/debt/add-person-dialog";
import { CategorySettingsRow } from "@/components/settings/category-settings-row";
import { IncomeSourceSettingsRow } from "@/components/settings/income-source-settings-row";
import { PersonSettingsRow } from "@/components/settings/person-settings-row";
import { PreferencesSettings } from "@/components/settings/preferences-settings";
import { BankAccountSettingsRow } from "@/components/settings/bank-account-settings-row";
import { CategoryRuleSettingsRow } from "@/components/settings/category-rule-settings-row";
import { AddCategoryRuleDialog } from "@/components/settings/add-category-rule-dialog";
import { ConnectBankAccountDialog } from "@/components/settings/connect-bank-account-dialog";
import { ArchivedList } from "@/components/settings/archived-list";
import {
  unarchiveCategory,
  unarchiveIncomeSource,
} from "@/app/grid/actions";
import { restorePerson } from "@/app/debt/actions";

export const dynamic = "force-dynamic";

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
  ]);

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
  const incomeSourceNameById = new Map(incomeSources.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Tabs defaultValue={tab === "bank-sync" ? "bank-sync" : "categories"}>
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="bank-sync">Bank sync</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Rename, regroup, add subcategories, or archive.
            </p>
            <AddCategoryDialog
              topLevelCategories={categoryTree.map((c) => ({ id: c.id, name: c.name }))}
              existingGroups={existingGroups}
            />
          </div>

          <div className="space-y-2">
            {categoryTree.map((category) => (
              <CategorySettingsRow
                key={category.id}
                category={category}
                color={groupColors.get(category.groupName ?? UNGROUPED)!}
                existingGroups={existingGroups}
                topLevelCategories={categoryTree.map((c) => ({ id: c.id, name: c.name }))}
                people={people.map((p) => ({ id: p.id, name: p.name }))}
              />
            ))}
          </div>

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
            <p className="text-sm text-muted-foreground">Add or archive income sources.</p>
            <AddIncomeSourceDialog />
          </div>

          <div className="space-y-2">
            {incomeSources.map((source) => (
              <IncomeSourceSettingsRow
                key={source.id}
                id={source.id}
                name={source.name}
                isPayAnchor={source.isPayAnchor}
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

        <TabsContent value="people" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Add or archive people tracked in the debt ledger.
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
                emptyLabel="No archived people."
              />
            </div>
          )}
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
                    provider={a.provider}
                    consentExpiresAt={a.consentExpiresAt.toString()}
                    lastSyncedAt={a.lastSyncedAt ? a.lastSyncedAt.toString() : null}
                  />
                ))}
              </div>
            )}
          </div>

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
              />
            </div>
            {categoryRules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rules yet.</p>
            ) : (
              <div className="space-y-2">
                {categoryRules.map((r) => (
                  <CategoryRuleSettingsRow
                    key={r.id}
                    id={r.id}
                    field={r.field}
                    operator={r.operator}
                    value={r.field === "amount" ? (parseInt(r.value, 10) / 100).toFixed(2) : r.value}
                    targetName={
                      r.targetType === "income"
                        ? (incomeSourceNameById.get(r.incomeSourceId!) ?? "Unknown income source")
                        : (categoryNameById.get(r.categoryId!) ?? "Unknown category")
                    }
                    debtPersonName={r.debtPersonId ? (personNameById.get(r.debtPersonId) ?? null) : null}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
