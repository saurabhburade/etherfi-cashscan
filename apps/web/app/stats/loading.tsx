import { DashboardShell } from "@/components/dashboard-shell";
import { ChartGridSkeleton } from "@/components/dashboard-skeletons";

export default function StatsLoading() {
  return (
    <DashboardShell active="stats">
      <main aria-label="Loading statistics" className="pb-20">
        <ChartGridSkeleton cards={4} topLevel />
      </main>
    </DashboardShell>
  );
}
