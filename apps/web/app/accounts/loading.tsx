import { DashboardShell } from "@/components/dashboard-shell";

const accountRows = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export default function AccountsLoading() {
  return (
    <DashboardShell active="accounts">
      <main aria-label="Loading accounts" className="pb-20">
        <section className="pt-6 sm:pt-8">
          <h1 className="text-2xl font-normal tracking-[-.03em] text-foreground">Accounts</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Explore indexed Cash Safe balances, deposits, spend, withdrawals, and debt across every supported network.
          </p>
        </section>
        <section aria-label="Loading account charts" className="mt-8 grid animate-pulse gap-5 lg:grid-cols-2">
          {["tiers", "cards"].map((chart) => (
            <div className="h-80 rounded-2xl border border-border/40 bg-secondary/40" key={chart} />
          ))}
        </section>
        <section
          aria-label="Loading account list"
          className="mt-8 animate-pulse overflow-hidden rounded-2xl border border-border/40 bg-card p-5"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="h-10 w-64 max-w-1/2 rounded-xl bg-secondary/60" />
            <div className="h-10 w-44 rounded-xl bg-secondary/60" />
          </div>
          <div className="mt-6 space-y-4">
            {accountRows.map((row) => (
              <div className="grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))] gap-4" key={row}>
                <div className="h-4 rounded-full bg-secondary/70" />
                <div className="h-4 rounded-full bg-secondary/50" />
                <div className="h-4 rounded-full bg-secondary/50" />
                <div className="h-4 rounded-full bg-secondary/50" />
                <div className="h-4 rounded-full bg-secondary/50" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
