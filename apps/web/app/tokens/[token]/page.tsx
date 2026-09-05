import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TokenDetailsSkeletonContent } from "@/app/tokens/[token]/_components/token-details-skeleton";
import { TokenAnalyticsCharts } from "@/components/analytics-charts";
import { DashboardShell } from "@/components/dashboard-shell";
import { TransactionTableSkeleton } from "@/components/dashboard-skeletons";
import { TokenDetailSummary } from "@/components/token-detail-summary";
import { TransactionExplorer } from "@/components/transaction-explorer";
import {
  loadActivityEventTypes,
  loadActivityPage,
  loadExplorerData,
  loadTokenAnalytics,
  type TokenAnalyticsRow,
} from "@/lib/envio";

export const metadata: Metadata = {
  title: "Token details · Ether.fi Cash Scanner",
  description: "View cumulative and per-chain Ether.fi Cash token activity.",
};

export default async function TokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dataPromise = loadExplorerData({}, "tokens");
  const tokenAnalyticsPromise = loadTokenAnalytics();

  return (
    <DashboardShell active="tokens" dataPromise={dataPromise}>
      <main className="pb-20">
        <Suspense fallback={<TokenPageSkeleton />}>
          <TokenDetails dataPromise={tokenAnalyticsPromise} tokenAddress={token} />
        </Suspense>
      </main>
    </DashboardShell>
  );
}

async function TokenDetails({
  dataPromise,
  tokenAddress,
}: {
  dataPromise: Promise<TokenAnalyticsRow[]>;
  tokenAddress: string;
}) {
  const data = await dataPromise;
  const normalizedAddress = tokenAddress.toLowerCase();
  const selected = data.find((row) => row.token.toLowerCase() === normalizedAddress);

  if (!selected) notFound();

  const symbol = selected.symbol.trim().toLowerCase();
  const relatedRows = symbol ? data.filter((row) => row.symbol.trim().toLowerCase() === symbol) : [selected];
  const tokenScopes = [...new Map(relatedRows.map((row) => [`${row.chainId}:${row.token}`, row])).values()].map(
    (row) => ({ chainId: row.chainId, token: row.token }),
  );
  const eventsPromise = loadActivityPage({ pageSize: 10, tokenScopes });
  const eventTypesPromise = loadActivityEventTypes({ tokenScopes });

  return (
    <>
      <TokenDetailSummary rows={relatedRows} />
      <TokenAnalyticsCharts data={relatedRows} showHeader={false} />
      <Suspense fallback={<TokenEventsSkeleton />}>
        <TokenEvents eventsPromise={eventsPromise} eventTypesPromise={eventTypesPromise} tokenScopes={tokenScopes} />
      </Suspense>
    </>
  );
}

async function TokenEvents({
  eventsPromise,
  eventTypesPromise,
  tokenScopes,
}: {
  eventsPromise: ReturnType<typeof loadActivityPage>;
  eventTypesPromise: ReturnType<typeof loadActivityEventTypes>;
  tokenScopes: Array<{ chainId: number; token: string }>;
}) {
  const [initialPage, availableEventTypes] = await Promise.all([eventsPromise, eventTypesPromise]);

  return (
    <section className="mt-16 border-t border-border pt-16" id="token-events">
      <h2 className="text-2xl font-normal tracking-[-.03em] text-foreground">Token events</h2>
      <p className="mt-2 text-sm text-muted-foreground">Latest indexed activity across every related token network.</p>
      <div className="mt-8">
        <TransactionExplorer
          availableEventTypes={availableEventTypes}
          initialPage={initialPage}
          showHeader={false}
          tokenScopes={tokenScopes}
        />
      </div>
    </section>
  );
}

function TokenEventsSkeleton() {
  return (
    <section aria-label="Loading token events" className="mt-16 border-t border-border pt-16">
      <div className="mb-8 animate-pulse">
        <div className="h-7 w-40 rounded-full bg-secondary/70" />
        <div className="mt-3 h-4 w-96 max-w-full rounded-full bg-secondary/45" />
      </div>
      <TransactionTableSkeleton />
    </section>
  );
}

function TokenPageSkeleton() {
  return (
    <div className="animate-pulse pt-8">
      <TokenDetailsSkeletonContent />
    </div>
  );
}
