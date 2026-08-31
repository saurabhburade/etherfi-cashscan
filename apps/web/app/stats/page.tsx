import { AnalyticsCharts, SpendOverviewCharts, TokenAnalyticsCharts } from "@/components/analytics-charts";
import { DashboardShell } from "@/components/dashboard-shell";
import { CashAccountAnalytics } from "@/components/parity/cash-account-analytics";
import { CashProductPanels } from "@/components/parity/cash-products";
import { loadExplorerData, loadTokenAnalytics } from "@/lib/envio";

export const runtime = "edge";

export default async function StatsPage() {
  const [data, tokenAnalytics] = await Promise.all([loadExplorerData(), loadTokenAnalytics()]);

  return (
    <DashboardShell active="stats" data={data}>
      <div className="pb-20">
        <SpendOverviewCharts
          data={data}
          sections={["spend", "cashback", "cards", "transactions"]}
          subtitle="Daily and cumulative spend, cashback, transaction, and active-card activity from indexed Cash events."
          title="Spend Volume, Cashbacks, Payments & Cards"
        />
        <CashProductPanels data={data} sections={["ramps"]} showTables={false} />
        <TokenAnalyticsCharts data={tokenAnalytics} showTable={false} />
        <CashAccountAnalytics data={data} sections={["tiers"]} showTables={false} />
        <AnalyticsCharts data={data} sections={["profiles", "active-hours"]} />
      </div>
    </DashboardShell>
  );
}
