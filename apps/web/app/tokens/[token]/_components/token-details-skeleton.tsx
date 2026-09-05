import { ChartGridSkeleton } from "@/components/dashboard-skeletons";

const metricSkeletonIds = ["reserve", "spend", "top-ups", "borrowed", "repaid", "withdrawals"];

export function TokenDetailsSkeletonContent() {
  return (
    <>
      <div className="h-3 w-28 rounded-full bg-secondary" />
      <div className="mt-5 flex items-center gap-4">
        <div className="size-14 rounded-full bg-secondary" />
        <div>
          <div className="h-7 w-44 rounded-full bg-secondary" />
          <div className="mt-3 h-4 w-64 max-w-full rounded-full bg-secondary/70" />
        </div>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metricSkeletonIds.map((metric) => (
          <div className="h-28 rounded-2xl bg-secondary/50" key={metric} />
        ))}
      </div>
      <ChartGridSkeleton cards={6} />
    </>
  );
}
