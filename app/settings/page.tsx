import {
  getCategoryTree,
  getIncomeSourceList,
  getArchivedCategories,
  getArchivedIncomeSources,
} from "@/lib/db/queries";
import { getPeopleWithBalances, getArchivedPeople } from "@/lib/db/debt";
import { getAppSettings } from "@/lib/db/settings";
import { buildGroupColorMap, UNGROUPED } from "@/lib/group-colors";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AddCategoryDialog } from "@/components/grid/add-category-dialog";
import { AddIncomeSourceDialog } from "@/components/grid/add-income-source-dialog";
import { AddPersonDialog } from "@/components/debt/add-person-dialog";
import { CategorySettingsRow } from "@/components/settings/category-settings-row";
import { IncomeSourceSettingsRow } from "@/components/settings/income-source-settings-row";
import { PersonSettingsRow } from "@/components/settings/person-settings-row";
import { PreferencesSettings } from "@/components/settings/preferences-settings";
import { ArchivedList } from "@/components/settings/archived-list";
import {
  unarchiveCategory,
  unarchiveIncomeSource,
} from "@/app/grid/actions";
import { restorePerson } from "@/app/debt/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [categoryTree, incomeSources, people, archivedCategories, archivedIncomeSources, archivedPeople, appSettings] =
    await Promise.all([
      getCategoryTree(),
      getIncomeSourceList(),
      getPeopleWithBalances(),
      getArchivedCategories(),
      getArchivedIncomeSources(),
      getArchivedPeople(),
      getAppSettings(),
    ]);

  const groupColors = buildGroupColorMap(categoryTree);
  const existingGroups = Array.from(
    new Set(categoryTree.map((c) => c.groupName).filter((g): g is string => !!g))
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
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
          <PreferencesSettings currency={appSettings.currency} dateFormat={appSettings.dateFormat} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
