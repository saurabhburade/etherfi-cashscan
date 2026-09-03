import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountAnalyticsCharts } from "@/components/account-analytics-charts";
import { AccountDetailSummary } from "@/components/account-detail-summary";
import { DashboardShell } from "@/components/dashboard-shell";
import { TransactionExplorer } from "@/components/transaction-explorer";
import { loadAccountAnalyticsDetail } from "@/lib/account-analytics";
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
  const detailPromise = loadAccountAnalyticsDetail(chainId, safe);
  const activityPromise = loadActivityPage({ account: safe, chainId: chainId ?? undefined, pageSize: 10 });
  const explorer = loadExplorerData({}, "status");
  const [detail, activity] = await Promise.all([detailPromise, activityPromise]);
  if (!detail.account) notFound();
  return (
    <DashboardShell active="accounts" dataPromise={explorer}>
      <main className="pb-20">
        <AccountDetailSummary detail={detail} safe={safe} />
        <AccountAnalyticsCharts detail={detail} />
        <section className="mt-16 border-t border-border pt-16">
          <h2 className="text-2xl font-normal tracking-[-.03em] text-foreground">Account events</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Canonical scanner events for this Safe across{" "}
            {chainId === null ? "all indexed networks" : `chain ${chainId}`}.
          </p>
          <div className="mt-6">
            <TransactionExplorer account={safe} initialPage={activity} showHeader={false} />
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
