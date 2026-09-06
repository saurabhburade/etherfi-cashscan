import { DashboardShell } from "@/components/dashboard-shell";
import { TokenDetailsSkeletonContent } from "./_components/token-details-skeleton";

export default function TokenLoading() {
  return (
    <DashboardShell active="tokens">
      <main aria-label="Loading token details" className="animate-pulse pb-20 pt-8">
        <TokenDetailsSkeletonContent />
      </main>
    </DashboardShell>
  );
}
