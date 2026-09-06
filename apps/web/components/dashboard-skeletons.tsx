import { EventTableColumnGroup, eventTableClassName } from "@/components/event-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const chartCardIds = ["primary", "secondary", "tertiary", "quaternary", "quinary", "senary"];
const activityIds = ["one", "two", "three", "four"];
const transactionColumnIds = ["event", "time", "network", "account", "transaction"];
const transactionRowIds = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function ChartGridSkeleton({
  cards = 2,
  flushBottom = false,
  topLevel = false,
}: {
  cards?: number;
  flushBottom?: boolean;
  topLevel?: boolean;
}) {
  return (
    <section
      aria-label="Loading charts"
      className={topLevel ? (flushBottom ? "pt-6" : "pt-6 pb-8") : "mt-16 border-t border-border pt-16"}
    >
      <div className="animate-pulse">
        <div className="h-7 w-64 max-w-3/4 rounded-full bg-secondary/70" />
        <div className="mt-3 h-4 w-[34rem] max-w-full rounded-full bg-secondary/45" />
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {chartCardIds.slice(0, cards).map((cardId) => (
            <div className="overflow-hidden rounded-2xl bg-secondary/50 p-6" key={cardId}>
              <div className="h-4 w-32 rounded-full bg-secondary" />
              <div className="mt-4 h-9 w-24 rounded-full bg-secondary" />
              <div className="mt-10 h-56 rounded-xl bg-secondary/55" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ActivityGridSkeleton() {
  return (
    <div aria-label="Loading latest activity" className="mt-5 grid animate-pulse gap-5 xl:grid-cols-2" role="status">
      {["spends", "cashbacks"].map((panel) => (
        <section className="overflow-hidden rounded-2xl border border-border/40 bg-secondary/35" key={panel}>
          <div className="border-b border-border/35 px-5 py-5">
            <div className="h-5 w-36 rounded-full bg-secondary" />
          </div>
          {activityIds.map((row) => (
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4" key={row}>
              <div className="size-11 rounded-full bg-secondary" />
              <div>
                <div className="h-4 w-40 rounded-full bg-secondary" />
                <div className="mt-2 h-3 w-28 rounded-full bg-secondary/70" />
              </div>
              <div className="h-3 w-16 rounded-full bg-secondary/70" />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function TransactionTableSkeleton() {
  return (
    <section
      aria-label="Loading transactions"
      className="animate-pulse overflow-hidden rounded-2xl border border-white/[.075] bg-[#181818]"
      role="status"
    >
      <span className="sr-only">Loading the next transaction page</span>
      <Table aria-hidden="true" className={eventTableClassName}>
        <EventTableColumnGroup />
        <TableHeader>
          <TableRow className="border-white/[.07] bg-transparent hover:bg-transparent">
            {transactionColumnIds.map((column) => (
              <TableHead key={column}>
                <div className="h-3 w-20 rounded-full bg-secondary" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactionRowIds.map((row) => (
            <TableRow className="border-border hover:bg-transparent" key={row}>
              <TableCell>
                <div className="flex min-w-56 items-center gap-3">
                  <div className="size-10 shrink-0 rounded-full bg-secondary" />
                  <div className="min-w-0 space-y-2">
                    <div className="h-3 w-32 rounded-full bg-secondary" />
                    <div className="h-3 w-20 rounded-full bg-secondary/70" />
                  </div>
                </div>
              </TableCell>
              {transactionColumnIds.slice(1).map((column) => (
                <TableCell key={`${row}-${column}`}>
                  <div className="h-3 w-24 max-w-full rounded-full bg-secondary/75" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
