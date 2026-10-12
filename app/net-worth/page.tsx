import { Wallet, Scale } from "lucide-react";
import { getAssetsWithValue, getAssetValueTrend } from "@/lib/db/assets";
import { getBankAccounts } from "@/lib/db/bank-sync";
import { getPeopleWithBalances } from "@/lib/db/debt";
import { getAppSettings } from "@/lib/db/settings";
import { formatPence } from "@/lib/money";
import { StatCard } from "@/components/grid/stat-card";
import { CategoryPieChart, type GroupSlice } from "@/components/reports/category-pie-chart";
import { NetWorthTrendChart } from "@/components/net-worth/net-worth-trend-chart";
import { AssetRow } from "@/components/net-worth/asset-row";
import { AddAssetDialog } from "@/components/net-worth/add-asset-dialog";
import { GROUP_PALETTE } from "@/lib/group-colors";
import { withCurrentUser } from "@/lib/db/current-user";

export const dynamic = "force-dynamic";

export default async function NetWorthPage() {
  return withCurrentUser(async () => {
    const [assets, trend, bankAccounts, people, { currency }] = await Promise.all([
      getAssetsWithValue(),
      getAssetValueTrend(),
      getBankAccounts(),
      getPeopleWithBalances(),
      getAppSettings(),
    ]);

    const assetsTotalPence = assets.reduce((sum, a) => sum + a.valuePence, 0);
    const bankTotalPence = bankAccounts.reduce((sum, a) => sum + (a.cachedBalancePence ?? 0), 0);
    // Signed already: positive = you owe them (a liability, subtract),
    // negative = they owe you (an asset, add) - summing the signed figure
    // directly and subtracting it does both at once, no branching needed.
    const debtTotalPence = people.reduce((sum, p) => sum + p.balancePence, 0);
    const netWorthPence = assetsTotalPence + bankTotalPence - debtTotalPence;

    // What you OWN, broken down - debt isn't mixed into this pie (a pie
    // assumes positive magnitudes; the Debt page already has its own
    // breakdown of who it's with). The stat card above is where debt is
    // netted off for the one true net worth figure.
    const slices: GroupSlice[] = [
      ...assets.map((a, i) => ({
        group: a.name,
        amountPence: a.valuePence,
        color: a.color ?? GROUP_PALETTE[i % GROUP_PALETTE.length],
        categories: [],
      })),
      ...(bankTotalPence !== 0
        ? [{ group: "Bank accounts", amountPence: bankTotalPence, color: GROUP_PALETTE[assets.length % GROUP_PALETTE.length], categories: [] }]
        : []),
    ].filter((s) => s.amountPence > 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Net worth</h1>
          <AddAssetDialog />
        </div>

        {(assets.length > 0 || bankTotalPence !== 0 || debtTotalPence !== 0) && (
          <StatCard
            label={netWorthPence >= 0 ? "Net worth" : "Net worth (negative)"}
            value={formatPence(Math.abs(netWorthPence), currency)}
            icon={Scale}
            tone={netWorthPence >= 0 ? "good" : "critical"}
          />
        )}

        {trend.length > 1 && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-1 font-medium">Assets over time</h2>
            <p className="mb-2 text-xs text-muted-foreground">Doesn&apos;t include bank balances or debt - just what you&apos;ve logged here.</p>
            <NetWorthTrendChart points={trend} color="var(--chart-1)" />
          </div>
        )}

        {slices.length > 1 && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-1 font-medium">What you own</h2>
            <p className="mb-2 text-xs text-muted-foreground">Assets and bank balances, before debt is netted off.</p>
            <CategoryPieChart slices={slices} compact />
          </div>
        )}

        {assets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
            <Wallet className="size-6" />
            <p>Nothing tracked yet. Add an asset to start.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {assets.map((asset, i) => (
              <AssetRow key={asset.id} asset={asset} fallbackColor={GROUP_PALETTE[i % GROUP_PALETTE.length]} />
            ))}
          </div>
        )}
      </div>
    );
  });
}
