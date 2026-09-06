import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AccountAnalyticsCharts } from "@/components/account-analytics-charts";
import { AccountDetailSummary } from "@/components/account-detail-summary";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChartGridSkeleton, TransactionTableSkeleton } from "@/components/dashboard-skeletons";
import { TransactionExplorer } from "@/components/transaction-explorer";
import {
  combineAccountAnalyticsDetail,
  loadAccountAnalyticsDays,
  loadAccountAnalyticsPositions,
  loadAccountAnalyticsSummary,
} from "@/lib/account-analytics";
import { loadActivityPage, loadExplorerData } from "@/lib/envio";

export const metadata: Metadata = { title: "Account · Ether.fi Cash Scanner" };
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ safe: string }>;
  searchParams: Promise<{ chain?: string }>;
}) {
  const [{ safe }, query] = await Promise.all([params, searchParams]);
  if (!/^0x[0-9a-fA-F]{40}$/.test(safe)) notFound();
  const chainId = query.chain === undefined ? null : Number(query.chain);
  if (chainId !== null && !Number.isInteger(chainId)) notFound();
  const summaryPromise = loadAccountAnalyticsSummary(chainId, safe);
  const positionsPromise = loadAccountAnalyticsPositions(chainId, safe);
  const daysPromise = loadAccountAnalyticsDays(chainId, safe);
  const activityPromise = loadActivityPage({ account: safe, chainId: chainId ?? undefined, pageSize: 10 });
  const explorer = loadExplorerData({}, "status");
  const summary = await summaryPromise;
  if (!summary.account) notFound();
  const summaryDetail = combineAccountAnalyticsDetail(
    summary,
    { tokens: [], safeInflowUsd: null, safeOutflowUsd: null, balanceUpdatedAt: null, priceObservedAt: null },
    { days: [] },
  );
  return (
    <DashboardShell active="accounts" dataPromise={explorer}>
      <main className="pb-20">
        <AccountDetailSummary detail={summaryDetail} safe={safe} />
        <Suspense fallback={<ChartGridSkeleton cards={10} />}>
          <DeferredAccountCharts daysPromise={daysPromise} positionsPromise={positionsPromise} summary={summary} />
        </Suspense>
        <section className="mt-16 border-t border-border pt-16">
          <h2 className="text-2xl font-normal tracking-[-.03em] text-foreground">Account events</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Canonical scanner events for this Safe across{" "}
            {chainId === null ? "all indexed networks" : `chain ${chainId}`}.
          </p>
          <div className="mt-6">
            <Suspense fallback={<TransactionTableSkeleton />}>
              <DeferredAccountEvents account={safe} activityPromise={activityPromise} />
            </Suspense>
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}

async function DeferredAccountCharts({
  daysPromise,
  positionsPromise,
  summary,
}: {
  daysPromise: ReturnType<typeof loadAccountAnalyticsDays>;
  positionsPromise: ReturnType<typeof loadAccountAnalyticsPositions>;
  summary: Awaited<ReturnType<typeof loadAccountAnalyticsSummary>>;
}) {
  const [positions, days] = await Promise.all([positionsPromise, daysPromise]);
  return <AccountAnalyticsCharts detail={combineAccountAnalyticsDetail(summary, positions, days)} />;
}

async function DeferredAccountEvents({
  account,
  activityPromise,
}: {
  account: string;
  activityPromise: ReturnType<typeof loadActivityPage>;
}) {
  return <TransactionExplorer account={account} initialPage={await activityPromise} showHeader={false} />;
}
