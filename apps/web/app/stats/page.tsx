import { Suspense } from "react";
import { AnalyticsCharts, SpendOverviewCharts, TokenAnalyticsCharts } from "@/components/analytics-charts";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChartGridSkeleton } from "@/components/dashboard-skeletons";
import { CashAccountAnalytics } from "@/components/parity/cash-account-analytics";
import { CashProductPanels } from "@/components/parity/cash-products";
import { type ExplorerData, loadExplorerData, loadTokenAnalytics, type TokenAnalyticsRow } from "@/lib/envio";

export const runtime = "edge";

export default function StatsPage() {
  const dataPromise = loadExplorerData();
  const tokenAnalyticsPromise = loadTokenAnalytics();

  return (
    <DashboardShell active="stats" dataPromise={dataPromise}>
      <div className="pb-20">
        <Suspense fallback={<ChartGridSkeleton cards={4} topLevel />}>
          <SpendStats dataPromise={dataPromise} />
        </Suspense>
        <Suspense fallback={<ChartGridSkeleton cards={2} />}>
          <RampStats dataPromise={dataPromise} />
        </Suspense>
        <Suspense fallback={<ChartGridSkeleton cards={6} />}>
          <TokenStats dataPromise={tokenAnalyticsPromise} />
        </Suspense>
        <Suspense fallback={<ChartGridSkeleton cards={2} />}>
          <TierStats dataPromise={dataPromise} />
        </Suspense>
        <Suspense fallback={<ChartGridSkeleton cards={2} />}>
          <ActiveHourStats dataPromise={dataPromise} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

async function SpendStats({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  const data = await dataPromise;
  return (
    <SpendOverviewCharts
      data={data}
      sections={["spend", "cashback", "cards", "transactions"]}
      subtitle="Daily and cumulative spend, cashback, transaction, and active-card activity from indexed Cash events."
      title="Spend Volume, Cashbacks, Payments & Cards"
    />
  );
}

async function RampStats({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  return <CashProductPanels data={await dataPromise} sections={["ramps"]} showTables={false} />;
}

async function TokenStats({ dataPromise }: { dataPromise: Promise<TokenAnalyticsRow[]> }) {
  return <TokenAnalyticsCharts data={await dataPromise} showTable={false} />;
}

async function TierStats({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  return <CashAccountAnalytics data={await dataPromise} sections={["tiers"]} showTables={false} />;
}

async function ActiveHourStats({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  return <AnalyticsCharts data={await dataPromise} sections={["active-hours"]} />;
}
