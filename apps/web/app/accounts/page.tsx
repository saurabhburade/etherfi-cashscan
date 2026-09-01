import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountExplorer } from "@/components/account-explorer";
import { SpendOverviewCharts } from "@/components/analytics-charts";
import { DashboardShell } from "@/components/dashboard-shell";
import { EffectiveTierDistribution } from "@/components/parity/cash-account-analytics";
import { accountAnalyticsEnabled, loadAccountAnalyticsPage } from "@/lib/account-analytics";
import { type ExplorerData, loadExplorerData } from "@/lib/envio";

export const metadata: Metadata = {
  title: "Accounts · Ether.fi Cash Scanner",
  description: "Explore Ether.fi Cash Safe balances, deposits, spend, withdrawals, and debt.",
};

export default function AccountsPage() {
  const explorer = loadExplorerData();
  return (
    <DashboardShell active="accounts" dataPromise={explorer}>
      <main className="pb-20">
        <section className="pt-6 sm:pt-8">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-normal tracking-[-.03em] text-foreground">Accounts</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Explore indexed Cash Safe balances, deposits, spend, withdrawals, and debt across every supported network.
            </p>
          </div>
        </section>
        <Suspense
          fallback={
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="h-80 animate-pulse rounded-2xl border border-border/40 bg-card" />
              <div className="h-80 animate-pulse rounded-2xl bg-secondary/50" />
            </div>
          }
        >
          <AccountCharts dataPromise={explorer} />
        </Suspense>
        <Suspense fallback={<div className="mt-8 h-80 animate-pulse rounded-2xl border border-border/40 bg-card" />}>
          <AccountList />
        </Suspense>
      </main>
    </DashboardShell>
  );
}

async function AccountCharts({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  const data = await dataPromise;
  return (
    <section className="mt-8 grid items-stretch gap-5 lg:grid-cols-2">
      <EffectiveTierDistribution data={data.tierDistribution} totalSafeCount={data.activeCardCount} />
      <SpendOverviewCharts data={data} embedded sections={["cards"]} showRangeControls={false} />
    </section>
  );
}

async function AccountList() {
  const page = await loadAccountAnalyticsPage();
  if (!accountAnalyticsEnabled)
    return (
      <Empty
        title="Account analytics is feature-gated"
        body="Apply the additive schema and enable CASH_EXPLORER_SCHEMA_ENABLED to use this view."
      />
    );
  if (!page.accounts.length)
    return (
      <Empty
        title="No account rollups yet"
        body="Run the separate enrichment backfill; Envio does not need to restart."
      />
    );
  return <AccountExplorer initialPage={page} />;
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-10 text-center">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
