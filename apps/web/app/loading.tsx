import { DashboardShell } from "@/components/dashboard-shell";
import { ActivityGridSkeleton, ChartGridSkeleton } from "@/components/dashboard-skeletons";

export default function OverviewLoading() {
  return (
    <DashboardShell active="overview">
      <main aria-label="Loading dashboard overview" className="pb-20">
        <ChartGridSkeleton cards={2} topLevel />
        <ActivityGridSkeleton />
      </main>
    </DashboardShell>
  );
}
