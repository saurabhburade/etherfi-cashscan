import { DashboardShell } from "@/components/dashboard-shell";
import { ChartGridSkeleton, TransactionTableSkeleton } from "@/components/dashboard-skeletons";
import { TransactionExplorerHeader } from "@/components/transaction-explorer";

export default function TransactionsLoading() {
  return (
    <DashboardShell active="transactions">
      <main aria-label="Loading transactions" className="pb-20">
        <section className="pt-6 sm:pt-8">
          <TransactionExplorerHeader />
        </section>
        <ChartGridSkeleton cards={2} topLevel />
        <TransactionTableSkeleton />
      </main>
    </DashboardShell>
  );
}
