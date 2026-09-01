import { DashboardShell } from "@/components/dashboard-shell";
import { ChartGridSkeleton } from "@/components/dashboard-skeletons";
import { TokenAnalyticsHeader } from "@/components/token-analytics-header";

export default function TokensLoading() {
  return (
    <DashboardShell active="tokens">
      <main aria-label="Loading tokens" className="pb-20">
        <section className="pt-6 sm:pt-8">
          <TokenAnalyticsHeader />
        </section>
        <ChartGridSkeleton cards={6} topLevel />
      </main>
    </DashboardShell>
  );
}
