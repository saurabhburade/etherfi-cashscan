import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsCharts } from "@/components/analytics-charts";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChartGridSkeleton, TransactionTableSkeleton } from "@/components/dashboard-skeletons";
import { TransactionExplorer, TransactionExplorerHeader } from "@/components/transaction-explorer";
import { type ExplorerData, loadActivityPage, loadExplorerData } from "@/lib/envio";

export const runtime = "edge";

export const metadata: Metadata = {
  title: "Transactions · Ether.fi Cash Scanner",
  description: "Explore the latest indexed Ether.fi Cash protocol transactions.",
};

export default function TransactionsPage() {
  const dataPromise = loadExplorerData();
  const activityPromise = loadActivityPage({ page: 1, pageSize: 10 });

  return (
    <DashboardShell active="transactions" dataPromise={dataPromise}>
      <main className="pb-20">
        <section className="pt-6 sm:pt-8">
          <TransactionExplorerHeader />
        </section>
        <Suspense fallback={<ChartGridSkeleton cards={2} topLevel />}>
          <TransactionProfiles dataPromise={dataPromise} />
        </Suspense>
        <Suspense fallback={<TransactionTableSkeleton />}>
          <TransactionActivity activityPromise={activityPromise} />
        </Suspense>
      </main>
    </DashboardShell>
  );
}

async function TransactionProfiles({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  return <AnalyticsCharts data={await dataPromise} flushTop sections={["profiles"]} showProfileHeader={false} />;
}

async function TransactionActivity({ activityPromise }: { activityPromise: ReturnType<typeof loadActivityPage> }) {
  return <TransactionExplorer initialPage={await activityPromise} showHeader={false} />;
}
