"use client";

import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import { type ReactNode, useRef } from "react";
import { ChartExportActions } from "@/components/chart-export-actions";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { CartesianXAxis, CartesianYAxis, ChartLegend } from "@/components/charts/cartesian-axis";
import { Grid } from "@/components/charts/grid";
import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { ExplorerData } from "@/lib/envio";
import { shortAddress } from "@/lib/format";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const currency = (value: number) => `$${compact.format(value)}`;
const count = (value: number) => compact.format(value);
const pieColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
];
type CashProductSection = "overview" | "leaderboards" | "cashback" | "ramps" | "debt";

export function CashProductPanels({
  data,
  sections = ["overview", "leaderboards", "cashback", "ramps", "debt"],
  showTables = true,
}: {
  data: ExplorerData;
  sections?: CashProductSection[];
  showTables?: boolean;
}) {
  const product = data;
  let cumulativeCashbackUsd = 0;
  let cumulativeRepaidUsd = 0;
  const daily = product.daily.map((row) => {
    cumulativeCashbackUsd += row.cashbackUsd;
    cumulativeRepaidUsd += row.repaidUsd;
    return { ...row, cumulativeCashbackUsd, cumulativeRepaidUsd, date: new Date(`${row.day}T00:00:00Z`) };
  });
  const debtReady = product.coverage.some((row) => row.key === "debt" && row.status === "derived");
  const cardsReady = product.coverage.some((row) => row.key === "spend-active-safes" && row.status === "derived");
  const leadingCashbackReceivers = product.cashbackReceivers.slice(0, 6);
  const leadingCashbackUsd = leadingCashbackReceivers.reduce((total, row) => total + row.amountUsd, 0);
  const cashbackDistribution = [
    ...leadingCashbackReceivers.map((row, index) => ({
      color: pieColors[index],
      label: shortAddress(row.account),
      value: row.amountUsd,
    })),
    { color: pieColors[6], label: "Other receivers", value: Math.max(0, product.cashbackUsd - leadingCashbackUsd) },
  ].filter((row) => row.value > 0);
  const show = (section: CashProductSection) => sections.includes(section);

  return (
    <>
      {show("overview") ? (
        <section className="scroll-mt-24 py-8 sm:py-10" id="overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Settled spend"
              value={currency(data.spendUsd)}
              note={`${count(data.spendCount)} transactions`}
            />
            <Metric
              label="Spend-active safes"
              value={count(data.activeCardCount)}
              note={cardsReady ? "Cross-chain distinct Spend accounts" : "Chain-qualified until dedupe backfill"}
            />
            <Metric
              label="Cashback issued"
              value={currency(product.cashbackUsd)}
              note={`${count(product.cashbackCount)} indexed events`}
            />
            <Metric label="Combined ramp volume" value={currency(product.combinedRampUsd)} note="Onramp + offramp" />
            <Metric
              label="Borrowed"
              value={product.borrowedUsd !== 0 ? currency(product.borrowedUsd) : "Pending"}
              note={
                debtReady
                  ? `${count(product.borrowerCount)} borrowers`
                  : "Event-priced volume only; full history pending"
              }
            />
            <Metric label="Repaid" value={currency(product.repaidUsd)} note="Indexed repayment events" />
            <Metric
              label="Outstanding debt"
              value={debtReady ? currency(product.outstandingDebtUsd) : "Pending"}
              note={debtReady ? "Interest and liquidation adjusted" : "Per-user accrued debt is not yet exact"}
            />
            <Metric label="Destination top-ups" value={count(data.topUpCount)} note="Settled ledger credits" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            USD values use indexed or derived event values. They are not card-provider authorization or merchant
            records.
          </p>
        </section>
      ) : null}

      {show("leaderboards") ? (
        <ProductSection
          id="leaderboards"
          title="Protocol leaderboards"
          subtitle="Rankings derived from indexed destination top-ups and settled cashback receipts. Network selection applies to both tables."
        >
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <LeaderboardCard
              empty="Top-up recipient rankings require the leaderboard entity reindex."
              heading="Top deposit recipients"
              note="Ranked by settled destination top-up count; the source funding wallet is not exposed by every destination event."
              rows={product.topUpRecipients.map((row) => ({
                account: row.account,
                chainId: row.chainId,
                primary: count(row.topUpCount),
                secondary: row.topUpCount === 1 ? "top-up" : "top-ups",
              }))}
            />
            <LeaderboardCard
              empty="Cashback receiver rankings require the leaderboard entity reindex."
              heading="Top cashback receivers"
              note="Paid Cashback plus PendingCashbackCleared settlements; pending issuance is excluded until received."
              rows={product.cashbackReceivers.map((row) => ({
                account: row.account,
                chainId: row.chainId,
                primary: currency(row.amountUsd),
                secondary: `${count(row.rewardCount)} rewards`,
              }))}
            />
          </div>
        </ProductSection>
      ) : null}

      {show("cashback") ? (
        <ProductSection
          id="cashback"
          level="subsection"
          title="Cashback"
          subtitle="Cashback emitted by CashEventEmitter; provider reward adjustments are outside this index."
        >
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <TrendCard
              hasData={product.cashbackCount > 0 || daily.some((row) => row.cashbackUsd !== 0)}
              label="Cashback history"
              value={currency(product.cashbackUsd)}
              empty="No indexed cashback history yet."
            >
              <BarChart
                aspectRatio="2.5 / 1"
                barGap={0.24}
                data={daily}
                margin={{ top: 24, right: 18, bottom: 72, left: 64 }}
                xDataKey="date"
              >
                <Grid fadeHorizontal={false} numTicksRows={5} stroke="var(--chart-grid)" yAxisId="cumulative" />
                <Bar dataKey="cashbackUsd" fill="var(--chart-2)" lineCap={3} />
                <Area
                  dataKey="cumulativeCashbackUsd"
                  fill="var(--chart-1)"
                  fillOpacity={0.06}
                  showHighlight
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  yAxisId="cumulative"
                />
                <CartesianYAxis tickFormatter={currency} yAxisId="cumulative" />
                <CartesianXAxis numTicks={4} />
                <ChartLegend
                  items={[
                    { color: "var(--chart-2)", label: "Daily cashback" },
                    { color: "var(--chart-1)", label: "Cumulative cashback" },
                  ]}
                />
                <ChartTooltip
                  rows={(point) => [
                    {
                      color: "var(--chart-2)",
                      label: "Daily cashback",
                      value: currency(Number(point.cashbackUsd ?? 0)),
                    },
                    {
                      color: "var(--chart-1)",
                      label: "Cumulative cashback",
                      value: currency(Number(point.cumulativeCashbackUsd ?? 0)),
                    },
                  ]}
                />
              </BarChart>
            </TrendCard>
            <CashbackDistributionCard data={cashbackDistribution} total={product.cashbackUsd} />
          </div>
        </ProductSection>
      ) : null}

      {show("ramps") ? (
        <ProductSection
          id="ramps"
          title="ether.fi Cash Payments (Onramp & Offramp Volumes)"
          subtitle="Canonical onramp and offramp events with daily, weekly, and token-level derived USD volume."
        >
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <TrendCard
              hasData={
                product.combinedRampUsd !== 0 ||
                product.onrampUsd !== 0 ||
                product.offrampUsd !== 0 ||
                daily.some((row) => row.onrampUsd !== 0 || row.offrampUsd !== 0)
              }
              label="Daily ramp volume"
              value={currency(product.combinedRampUsd)}
              empty="No indexed ramp history yet."
            >
              <AreaChart
                aspectRatio="2.25 / 1"
                data={daily}
                margin={{ top: 24, right: 18, bottom: 72, left: 18 }}
                xDataKey="date"
              >
                <Grid fadeHorizontal={false} numTicksRows={4} stroke="var(--chart-grid)" />
                <Area
                  dataKey="onrampUsd"
                  fill="var(--chart-1)"
                  fillOpacity={0.05}
                  showHighlight
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                />
                <Area
                  dataKey="offrampUsd"
                  fill="var(--chart-3)"
                  fillOpacity={0.05}
                  showHighlight
                  stroke="var(--chart-3)"
                  strokeWidth={2.5}
                />
                <CartesianXAxis numTicks={5} />
                <ChartLegend
                  items={[
                    { color: "var(--chart-1)", label: "Onramp" },
                    { color: "var(--chart-3)", label: "Offramp" },
                  ]}
                />
                <ChartTooltip
                  rows={(point) => [
                    { color: "var(--chart-1)", label: "Onramp", value: currency(Number(point.onrampUsd ?? 0)) },
                    { color: "var(--chart-3)", label: "Offramp", value: currency(Number(point.offrampUsd ?? 0)) },
                  ]}
                />
              </AreaChart>
            </TrendCard>
            <RampDistributionCard offrampUsd={product.offrampUsd} onrampUsd={product.onrampUsd} />
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            EURC is converted with indexed daily Chainlink EUR/USD observations; the latest indexed observation is used
            only when that UTC day has no rate.
          </p>
        </ProductSection>
      ) : null}

      {show("debt") ? (
        <ProductSection
          id="debt"
          title="UserSafe Balances"
          subtitle="Raw borrow, repay, liquidation and interest events are indexed. Exact historical USD/ETH AUM and accrued debt stay pending until pricing and full balance state are reconstructed."
        >
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <TrendCard
              hasData={
                product.borrowedUsd !== 0 ||
                product.repaidUsd !== 0 ||
                daily.some((row) => row.borrowedUsd !== 0 || row.repaidUsd !== 0)
              }
              label="Daily borrowing & repayment"
              value={debtReady ? currency(product.outstandingDebtUsd) : "USD parity pending"}
              empty="No event-priced UserSafe debt history yet."
            >
              <BarChart
                aspectRatio="2.25 / 1"
                barGap={0.24}
                data={daily}
                margin={{ top: 24, right: 18, bottom: 92, left: 64 }}
                xDataKey="date"
              >
                <Grid fadeHorizontal={false} numTicksRows={4} stroke="var(--chart-grid)" />
                <Bar dataKey="borrowedUsd" fill="var(--chart-2)" lineCap={3} />
                <Bar dataKey="repaidUsd" fill="var(--chart-3)" lineCap={3} />
                <Area
                  dataKey="cumulativeRepaidUsd"
                  fill="var(--chart-1)"
                  fillOpacity={0.08}
                  showHighlight
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                />
                <CartesianYAxis tickFormatter={currency} />
                <CartesianXAxis numTicks={4} />
                <ChartLegend
                  items={[
                    { color: "var(--chart-2)", label: "Daily borrowed" },
                    { color: "var(--chart-3)", label: "Daily repaid" },
                    { color: "var(--chart-1)", label: "Cumulative repaid" },
                  ]}
                />
                <ChartTooltip
                  rows={(point) => [
                    {
                      color: "var(--chart-2)",
                      label: "Daily borrowed",
                      value: currency(Number(point.borrowedUsd ?? 0)),
                    },
                    { color: "var(--chart-3)", label: "Daily repaid", value: currency(Number(point.repaidUsd ?? 0)) },
                    {
                      color: "var(--chart-1)",
                      label: "Cumulative repaid",
                      value: currency(Number(point.cumulativeRepaidUsd ?? 0)),
                    },
                  ]}
                />
              </BarChart>
            </TrendCard>
            <DefinitionCard title="Debt KPIs">
              <Definition
                label="Borrowed (event USD)"
                value={product.borrowedUsd !== 0 ? currency(product.borrowedUsd) : "Pending pricing"}
              />
              <Definition label="Repaid (event USD)" value={currency(product.repaidUsd)} />
              <Definition label="Borrowers" value={debtReady ? count(product.borrowerCount) : "Pending parity"} />
            </DefinitionCard>
          </div>
          {showTables ? (
            <TokenTable
              heading="Debt by token"
              rows={product.debtTokens}
              empty="Debt token breakdown is pending entity backfill."
              kind="debt"
            />
          ) : null}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <DefinitionCard title="UserSafe balance / AUM">
              <Definition label="Historical USD balance" value="Pending exact state" />
              <Definition label="Historical ETH balance" value="Pending exact state" />
              <Definition label="Required source" value="Transfers + lend/collateral" />
            </DefinitionCard>
            <DefinitionCard title="What is indexed now">
              <Definition label="Safe discovery" value="Factory events" />
              <Definition label="Debt lifecycle" value="Borrow · repay · liquidate" />
              <Definition label="Interest" value="Index updates retained" />
            </DefinitionCard>
          </div>
        </ProductSection>
      ) : null}
    </>
  );
}

export function CoveragePanel({ data }: { data: ExplorerData }) {
  const coverage = data.coverage;
  return (
    <section className="mt-5" id="coverage">
      <article className="rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
        <span className="text-xs text-muted-foreground">Data provenance</span>
        <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">Coverage & boundaries</h3>
        {coverage.length ? (
          <div className="mt-5 divide-y divide-border">
            {coverage.map((row) => (
              <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={row.key}>
                <div>
                  <p className="text-sm text-foreground">{row.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.source} · {row.note}
                  </p>
                </div>
                <Status status={row.status} />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            Coverage metadata is not available from this GraphQL schema yet.
          </p>
        )}
      </article>
    </section>
  );
}

function ProductSection({
  children,
  id,
  level = "category",
  subtitle,
  title,
}: {
  children: ReactNode;
  id: string;
  level?: "category" | "subsection";
  subtitle: string;
  title: string;
}) {
  const Heading = level === "category" ? "h2" : "h3";
  return (
    <section
      className={
        level === "category" ? "mt-16 min-w-0 scroll-mt-24 border-t border-border pt-16" : "mt-10 min-w-0 scroll-mt-24"
      }
      id={id}
    >
      <Heading
        className={
          level === "category" ? "text-2xl font-normal tracking-[-.03em]" : "text-xl font-normal tracking-[-.02em]"
        }
      >
        {title}
      </Heading>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-8 min-w-0">{children}</div>
    </section>
  );
}
function Metric({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary/50 p-5 text-secondary-foreground">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="mt-2 block text-2xl font-normal tracking-[-.03em] text-foreground">{value}</strong>
      <span className="mt-2 block text-xs text-muted-foreground">{note}</span>
    </div>
  );
}
function TrendCard({
  children,
  empty,
  hasData,
  label,
  value,
}: {
  children: ReactNode;
  empty: string;
  hasData: boolean;
  label: string;
  value: string;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-border/40 bg-card text-card-foreground">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">{label}</span>
          <strong className="mt-2 block text-2xl font-normal tracking-[-.03em]">{value}</strong>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename={`${slug(label)}.svg`}
          title={`Ether.fi: ${label}`}
          value={value}
        />
      </div>
      <div className="mt-2 min-w-0" ref={chartContainerRef}>
        {hasData ? (
          children
        ) : (
          <div className="grid aspect-[2.25/1] place-items-center px-6 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        )}
      </div>
    </article>
  );
}
function DefinitionCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
      <span className="text-sm text-muted-foreground">{title}</span>
      <div className="mt-5">{children}</div>
    </article>
  );
}
function RampDistributionCard({ offrampUsd, onrampUsd }: { offrampUsd: number; onrampUsd: number }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const total = onrampUsd + offrampUsd;
  const data = [
    { color: "var(--chart-1)", label: "Onramp", value: onrampUsd },
    { color: "var(--chart-3)", label: "Offramp", value: offrampUsd },
  ];
  return (
    <article className="min-w-0 rounded-2xl border border-border/40 bg-card p-5 text-card-foreground sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">Ramp KPIs</span>
          <h3 className="mt-2 text-xl font-normal tracking-[-.02em]">by direction</h3>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename="etherfi-ramp-distribution.svg"
          title="Ether.fi: Ramp distribution"
          value={currency(total)}
        />
      </div>
      <div ref={chartContainerRef}>
        {total > 0 ? (
          <div className="mt-6 grid items-center gap-6 sm:grid-cols-[minmax(180px,224px)_minmax(0,1fr)]">
            <PieChart className="mx-auto max-w-56" cornerRadius={3} data={data} innerRadius={68} padAngle={0.018}>
              <PieCenter
                defaultLabel="All"
                formatOptions={{ maximumFractionDigits: 2, notation: "compact" }}
                prefix="$"
                valueClassName="text-lg"
              />
              {data.map((row, index) => (
                <PieSlice color={row.color} hoverEffect="grow" index={index} key={row.label} />
              ))}
            </PieChart>
            <div className="min-w-0 space-y-3">
              {data.map((row) => (
                <div className="flex items-center gap-3 text-xs" key={row.label}>
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: row.color }} />
                  <span className="min-w-0 flex-1 text-muted-foreground">{row.label}</span>
                  <span className="shrink-0 font-mono text-foreground">{currency(row.value)}</span>
                </div>
              ))}
              <div className="border-t border-border/40 pt-3 text-right text-sm text-foreground">
                All · {currency(total)}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-muted-foreground">
            No indexed ramp volume yet.
          </div>
        )}
      </div>
    </article>
  );
}
function CashbackDistributionCard({
  data,
  total,
}: {
  data: Array<{ color: string; label: string; value: number }>;
  total: number;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  return (
    <article className="rounded-2xl border border-border/40 bg-card p-5 text-card-foreground sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">Cashback distribution</span>
          <h3 className="mt-2 text-xl font-normal tracking-[-.02em]">by receiver</h3>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename="etherfi-cashback-distribution.svg"
          title="Ether.fi: Cashback distribution"
          value={currency(total)}
        />
      </div>
      <div ref={chartContainerRef}>
        {data.length ? (
          <div className="mt-6 grid items-center gap-6 sm:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
            <PieChart className="mx-auto max-w-60" cornerRadius={3} data={data} innerRadius={72} padAngle={0.018}>
              <PieCenter defaultLabel="All" valueClassName="text-lg" />
              {data.map((row, index) => (
                <PieSlice color={row.color} hoverEffect="grow" index={index} key={row.label} />
              ))}
            </PieChart>
            <div className="min-w-0 space-y-3">
              {data.map((row) => (
                <div className="flex items-center gap-3 text-xs" key={row.label}>
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: row.color }} />
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{row.label}</span>
                  <span className="shrink-0 font-mono text-foreground">{currency(row.value)}</span>
                </div>
              ))}
              <div className="border-t border-border/40 pt-3 text-right text-sm text-foreground">
                All · {currency(total)}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-muted-foreground">
            Cashback receiver distribution is pending entity backfill.
          </div>
        )}
      </div>
    </article>
  );
}
function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}
function LeaderboardCard({
  empty,
  heading,
  note,
  rows,
}: {
  empty: string;
  heading: string;
  note: string;
  rows: Array<{ account: string; chainId: number; primary: string; secondary: string }>;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
      <div className="px-5 py-5 sm:px-6">
        <h3 className="text-lg font-normal tracking-[-.02em]">{heading}</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p>
      </div>
      {rows.length ? (
        <div className="divide-y divide-border border-t border-border">
          {rows.map((row, index) => (
            <div
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4 sm:px-6"
              key={`${row.chainId}:${row.account}`}
            >
              <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-foreground">{shortAddress(row.account)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {INDEXED_CHAIN_BY_ID.get(row.chainId)?.name ?? row.chainId}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm text-foreground">{row.primary}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.secondary}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-border px-6 py-12 text-center text-sm text-muted-foreground">{empty}</div>
      )}
    </article>
  );
}
function TokenTable({
  empty,
  heading,
  kind,
  rows,
}: {
  empty: string;
  heading: string;
  kind: "ramp" | "debt";
  rows: ExplorerData["rampTokens"] | ExplorerData["debtTokens"];
}) {
  return (
    <article className="mt-5 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
      <h3 className="px-5 py-5 text-lg font-normal tracking-[-.02em] sm:px-6">{heading}</h3>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-y border-border text-xs text-muted-foreground">
              <tr>
                {kind === "ramp" ? <th className="px-6 py-3 font-normal">Direction</th> : null}
                <th className="px-6 py-3 font-normal">Token</th>
                {kind === "ramp" ? (
                  <th className="px-6 py-3 text-right font-normal">Volume</th>
                ) : (
                  <>
                    <th className="px-6 py-3 text-right font-normal">Borrowed</th>
                    <th className="px-6 py-3 text-right font-normal">Repaid</th>
                    <th className="px-6 py-3 text-right font-normal">Outstanding</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className="border-b border-border last:border-0"
                  key={`${kind === "ramp" ? (row as ExplorerData["rampTokens"][number]).label : "debt"}:${row.token}`}
                >
                  {kind === "ramp" ? (
                    <td className="px-6 py-4 capitalize text-muted-foreground">
                      {(row as ExplorerData["rampTokens"][number]).label}
                    </td>
                  ) : null}
                  <td className="px-6 py-4 font-mono text-foreground">{row.tokenSymbol || row.token}</td>
                  {kind === "ramp" ? (
                    <td className="px-6 py-4 text-right font-mono text-foreground">
                      {currency((row as ExplorerData["rampTokens"][number]).amountUsd)}
                    </td>
                  ) : (
                    <>
                      <td className="px-6 py-4 text-right font-mono text-foreground">
                        {currency((row as ExplorerData["debtTokens"][number]).borrowedUsd)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-foreground">
                        {currency((row as ExplorerData["debtTokens"][number]).repaidUsd)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-foreground">
                        {currency((row as ExplorerData["debtTokens"][number]).outstandingUsd)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">{empty}</div>
      )}
    </article>
  );
}
function Status({ status }: { status: ExplorerData["coverage"][number]["status"] }) {
  const styles = {
    live: "text-emerald-600 dark:text-emerald-400",
    derived: "text-sky-600 dark:text-sky-300",
    pending: "text-amber-600 dark:text-amber-300",
    offchain: "text-muted-foreground",
  };
  const labels = { live: "Indexed", derived: "Derived", pending: "Pending", offchain: "Provider only" };
  return <span className={`text-xs ${styles[status]}`}>{labels[status]}</span>;
}
function slug(value: string) {
  return `etherfi-${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}
