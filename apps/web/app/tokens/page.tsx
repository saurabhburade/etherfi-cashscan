import type { Metadata } from "next";
import { Suspense } from "react";
import { TokenAnalyticsCharts } from "@/components/analytics-charts";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChartGridSkeleton } from "@/components/dashboard-skeletons";
import { TokenAnalyticsHeader } from "@/components/token-analytics-header";
import { loadExplorerData, loadTokenAnalytics, type TokenAnalyticsRow } from "@/lib/envio";

export const metadata: Metadata = {
  title: "Tokens · Ether.fi Cash Scanner",
  description: "Explore indexed Ether.fi Cash token reserves, flows, spend, withdrawals, and debt.",
};

export default function TokensPage() {
  const dataPromise = loadExplorerData({}, "tokens");
  const tokenAnalyticsPromise = loadTokenAnalytics();

  return (
    <DashboardShell active="tokens" dataPromise={dataPromise}>
      <main className="pb-20">
        <section className="pt-6 sm:pt-8">
          <TokenAnalyticsHeader />
        </section>
        <Suspense fallback={<ChartGridSkeleton cards={6} topLevel />}>
          <TokenAnalytics dataPromise={tokenAnalyticsPromise} />
        </Suspense>
      </main>
    </DashboardShell>
  );
}

async function TokenAnalytics({ dataPromise }: { dataPromise: Promise<TokenAnalyticsRow[]> }) {
  return <TokenAnalyticsCharts data={await dataPromise} flushTop showHeader={false} />;
}
