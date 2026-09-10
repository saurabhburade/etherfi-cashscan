"use client";

import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { formatUnits } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { ChartExportActions } from "@/components/chart-export-actions";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { CartesianXAxis, CartesianYAxis, ChartLegend } from "@/components/charts/cartesian-axis";
import { Grid } from "@/components/charts/grid";
import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { Scatter, ScatterChart } from "@/components/charts/scatter-chart";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { XAxis } from "@/components/charts/x-axis";
import { TokenIcon } from "@/components/token-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DailyAnalytics, ExplorerData, TokenAnalyticsRow } from "@/lib/envio";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const chartRangeEasing = "cubic-bezier(0.22, 1, 0.36, 1)";
const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
];
type OverviewChartSection = "spend" | "cashback" | "cards" | "transactions" | "spend-share";
type AnalyticsSectionName = "profiles" | "balances" | "active-hours";
type OverviewRange = "24h" | "7d" | "30d" | "90d" | "all";
const overviewRanges: Array<{ label: string; value: OverviewRange; days?: number }> = [
  { label: "24h", value: "24h", days: 1 },
  { label: "7d", value: "7d", days: 7 },
  { label: "30d", value: "30d", days: 30 },
  { label: "90d", value: "90d", days: 90 },
  { label: "All time", value: "all" },
];
const OVERVIEW_RANGE_BY_VALUE = new Map(overviewRanges.map((option) => [option.value, option]));

type OverviewPoint = DailyAnalytics & { cumulativeCashbackUsd: number; date: Date };

function buildLast24HourlyPoints(data: ExplorerData): OverviewPoint[] {
  const currentHour = Math.floor(Date.now() / 3_600_000);
  const firstHour = currentHour - 23;
  const hourlyByHour = new Map(data.hourly.map((row) => [row.hour, row]));
  const recent = Array.from({ length: 24 }, (_, index) => {
    const hour = firstHour + index;
    return (
      hourlyByHour.get(hour) ?? {
        hour,
        spendCount: 0,
        spendUsd: 0,
        activeCards: 0,
        newCards: 0,
        cashbackUsd: 0,
      }
    );
  });
  let cumulativeSpendUsd = Math.max(0, data.spendUsd - recent.reduce((total, row) => total + row.spendUsd, 0));
  let cumulativeTransactions = Math.max(0, data.spendCount - recent.reduce((total, row) => total + row.spendCount, 0));
  let cumulativeCards = Math.max(0, data.activeCardCount - recent.reduce((total, row) => total + row.newCards, 0));
  let cumulativeCashbackUsd = Math.max(0, data.cashbackUsd - recent.reduce((total, row) => total + row.cashbackUsd, 0));

  return recent.map((row) => {
    cumulativeSpendUsd += row.spendUsd;
    cumulativeTransactions += row.spendCount;
    cumulativeCards += row.newCards;
    cumulativeCashbackUsd += row.cashbackUsd;
    const date = new Date(row.hour * 3_600_000);
    return {
      day: date.toISOString(),
      date,
      spendUsd: row.spendUsd,
      transactions: row.spendCount,
      activeCards: row.activeCards,
      newCards: row.newCards,
      topUps: 0,
      cashbackUsd: row.cashbackUsd,
      onrampUsd: 0,
      offrampUsd: 0,
      borrowedUsd: 0,
      repaidUsd: 0,
      cumulativeSpendUsd,
      cumulativeTransactions,
      cumulativeCards,
      cumulativeCashbackUsd,
    };
  });
}

export function SpendOverviewCharts({
  data,
  embedded = false,
  flushBottom = false,
  sections = ["spend", "cards"],
  showRangeControls = true,
  subtitle,
  title,
}: {
  data: ExplorerData;
  embedded?: boolean;
  flushBottom?: boolean;
  sections?: OverviewChartSection[];
  showRangeControls?: boolean;
  subtitle?: string;
  title?: string;
}) {
  const [range, setRange] = useState<OverviewRange>("all");
  const [animateRangeChanges, setAnimateRangeChanges] = useState(false);
  let cumulativeCashbackUsd = 0;
  const daily = data.daily.map((row) => {
    cumulativeCashbackUsd += row.cashbackUsd;
    return { ...row, cumulativeCashbackUsd, date: new Date(`${row.day}T00:00:00Z`) };
  });
  const selectedRange = OVERVIEW_RANGE_BY_VALUE.get(range);
  const rangeDays = selectedRange?.days;
  const visibleDaily = range === "24h" ? buildLast24HourlyPoints(data) : rangeDays ? daily.slice(-rangeDays) : daily;
  const visibleSpendUsd = visibleDaily.reduce((total, row) => total + row.spendUsd, 0);
  const visibleCashbackUsd = visibleDaily.reduce((total, row) => total + row.cashbackUsd, 0);
  const visibleTransactions = visibleDaily.reduce((total, row) => total + row.transactions, 0);
  const visibleNewCards = visibleDaily.reduce((total, row) => total + row.newCards, 0);
  const today = new Date().toISOString().slice(0, 10);
  const newCardsToday = data.daily.find((row) => row.day === today)?.newCards ?? 0;
  const issuedCards = range === "all" ? newCardsToday : visibleNewCards;
  const issuedContext = range === "all" ? "today" : `in ${selectedRange?.label ?? range}`;
  const spendShare = data.spendProfiles.map((row, index) => ({
    label: row.bucket,
    value: row.spendUsd,
    color: colors[index],
  }));

  const content = (
    <>
      {showRangeControls ? (
        <Tabs
          className="mb-4 overflow-x-auto pb-1 sm:items-end"
          onValueChange={(value) => {
            setAnimateRangeChanges(true);
            setRange(value as OverviewRange);
          }}
          value={range}
        >
          <TabsList
            aria-label="Chart duration"
            className="shrink-0 border border-secondary bg-background"
            indicatorClassName="bg-secondary dark:border-transparent dark:bg-secondary"
          >
            {overviewRanges.map((option) => (
              <TabsTrigger
                className="flex-none px-3 font-sans text-xs! font-medium tracking-normal text-muted-foreground data-active:text-foreground dark:data-active:text-foreground"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      <div className={`grid h-full gap-5 ${sections.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {sections.includes("spend") ? (
          <TimeSeriesCard
            duration={selectedRange?.label ?? range}
            filename={`etherfi-spend-volume-${range}.svg`}
            label="Spend Volume"
            total={money(visibleSpendUsd)}
          >
            <BarChart
              animationDuration={animateRangeChanges ? 600 : 0}
              animationEasing={chartRangeEasing}
              aspectRatio="2 / 1"
              barGap={0.24}
              data={visibleDaily}
              margin={{ top: 24, right: 18, bottom: 72, left: 64 }}
              revealSignature={range}
              xDataKey="date"
            >
              <Grid
                fadeHorizontal={false}
                numTicksRows={3}
                stroke="var(--chart-grid)"
                strokeOpacity={0.5}
                yAxisId="cumulative"
              />
              <Bar dataKey="spendUsd" fill="var(--chart-2)" lineCap={3} />
              <Area
                dataKey="cumulativeSpendUsd"
                fill="var(--chart-1)"
                fillOpacity={0.08}
                showHighlight
                stroke="var(--chart-1)"
                strokeWidth={2}
                yAxisId="cumulative"
              />
              <CartesianYAxis numTicks={3} tickFormatter={money} yAxisId="cumulative" />
              <CartesianXAxis numTicks={3} />
              <ChartLegend
                items={[
                  { color: "var(--chart-2)", label: "Daily spend" },
                  { color: "var(--chart-1)", label: "Cumulative spend" },
                ]}
              />
              <ChartTooltip
                rows={(point) => [
                  { color: "var(--chart-2)", label: "Daily spend", value: money(Number(point.spendUsd ?? 0)) },
                  { color: "var(--chart-1)", label: "Cumulative", value: money(Number(point.cumulativeSpendUsd ?? 0)) },
                ]}
              />
            </BarChart>
          </TimeSeriesCard>
        ) : null}
        {sections.includes("cashback") ? (
          <TimeSeriesCard
            duration={selectedRange?.label ?? range}
            filename={`etherfi-cashback-${range}.svg`}
            label="Cashbacks"
            total={money(visibleCashbackUsd)}
          >
            <BarChart
              animationDuration={animateRangeChanges ? 600 : 0}
              animationEasing={chartRangeEasing}
              aspectRatio="2 / 1"
              barGap={0.24}
              data={visibleDaily}
              margin={{ top: 24, right: 18, bottom: 72, left: 64 }}
              revealSignature={range}
              xDataKey="date"
            >
              <Grid
                fadeHorizontal={false}
                numTicksRows={3}
                stroke="var(--chart-grid)"
                strokeOpacity={0.5}
                yAxisId="cumulative"
              />
              <Bar dataKey="cashbackUsd" fill="var(--chart-3)" lineCap={3} />
              <Area
                dataKey="cumulativeCashbackUsd"
                fill="var(--chart-1)"
                fillOpacity={0.08}
                showHighlight
                stroke="var(--chart-1)"
                strokeWidth={2}
                yAxisId="cumulative"
              />
              <CartesianYAxis numTicks={3} tickFormatter={money} yAxisId="cumulative" />
              <CartesianXAxis numTicks={3} />
              <ChartLegend
                items={[
                  { color: "var(--chart-3)", label: "Daily cashback" },
                  { color: "var(--chart-1)", label: "Cumulative cashback" },
                ]}
              />
              <ChartTooltip
                rows={(point) => [
                  { color: "var(--chart-3)", label: "Daily cashback", value: money(Number(point.cashbackUsd ?? 0)) },
                  {
                    color: "var(--chart-1)",
                    label: "Cumulative cashback",
                    value: money(Number(point.cumulativeCashbackUsd ?? 0)),
                  },
                ]}
              />
            </BarChart>
          </TimeSeriesCard>
        ) : null}
        {sections.includes("cards") ? (
          <TimeSeriesCard
            duration={selectedRange?.label ?? range}
            filename={`etherfi-active-new-cards-${range}.svg`}
            label="Active/new cards"
            total={`${compact.format(data.activeCardCount)} / ${compact.format(issuedCards)} issued ${issuedContext}`}
          >
            <AreaChart
              animationDuration={animateRangeChanges ? 600 : 0}
              animationEasing={chartRangeEasing}
              aspectRatio="2 / 1"
              data={visibleDaily}
              margin={{ top: 24, right: 18, bottom: 72, left: 64 }}
              revealSignature={range}
              xDataKey="date"
            >
              <Grid fadeHorizontal={false} numTicksRows={3} stroke="var(--chart-grid)" strokeOpacity={0.5} />
              <Area
                dataKey="cumulativeCards"
                fill="var(--chart-1)"
                fillOpacity={0.08}
                showHighlight
                stroke="var(--chart-1)"
                strokeWidth={2}
              />
              <Area
                dataKey="activeCards"
                fill="var(--chart-2)"
                fillOpacity={0.04}
                showHighlight={false}
                stroke="var(--chart-2)"
                strokeWidth={1.5}
              />
              <Area
                dataKey="newCards"
                fill="var(--chart-4)"
                fillOpacity={0.02}
                showHighlight={false}
                stroke="var(--chart-4)"
                strokeWidth={1.25}
              />
              <CartesianYAxis numTicks={3} tickFormatter={compact.format} />
              <CartesianXAxis numTicks={3} />
              <ChartLegend
                items={[
                  { color: "var(--chart-1)", label: "Cumulative cards" },
                  { color: "var(--chart-2)", label: "Daily active" },
                  { color: "var(--chart-4)", label: "New cards" },
                ]}
              />
              <ChartTooltip
                rows={(point) => [
                  {
                    color: "var(--chart-1)",
                    label: "Cumulative cards",
                    value: wholeNumber.format(Number(point.cumulativeCards ?? 0)),
                  },
                  {
                    color: "var(--chart-2)",
                    label: "Daily Active cards",
                    value: wholeNumber.format(Number(point.activeCards ?? 0)),
                  },
                  {
                    color: "var(--chart-4)",
                    label: "New cards",
                    value: wholeNumber.format(Number(point.newCards ?? 0)),
                  },
                ]}
              />
            </AreaChart>
          </TimeSeriesCard>
        ) : null}
        {sections.includes("transactions") ? (
          <TimeSeriesCard
            duration={selectedRange?.label ?? range}
            filename={`etherfi-transactions-${range}.svg`}
            label="Transactions"
            total={compact.format(visibleTransactions)}
          >
            <BarChart
              animationDuration={animateRangeChanges ? 600 : 0}
              animationEasing={chartRangeEasing}
              aspectRatio="2 / 1"
              barGap={0.24}
              data={visibleDaily}
              margin={{ top: 24, right: 18, bottom: 72, left: 64 }}
              revealSignature={range}
              xDataKey="date"
            >
              <Grid
                fadeHorizontal={false}
                numTicksRows={3}
                stroke="var(--chart-grid)"
                strokeOpacity={0.5}
                yAxisId="cumulative"
              />
              <Bar dataKey="transactions" fill="var(--chart-2)" lineCap={3} />
              <Area
                dataKey="cumulativeTransactions"
                fill="var(--chart-1)"
                fillOpacity={0.08}
                showHighlight
                stroke="var(--chart-1)"
                strokeWidth={2}
                yAxisId="cumulative"
              />
              <CartesianYAxis numTicks={3} tickFormatter={compact.format} yAxisId="cumulative" />
              <CartesianXAxis numTicks={3} />
              <ChartLegend
                items={[
                  { color: "var(--chart-2)", label: "Daily transactions" },
                  { color: "var(--chart-1)", label: "Cumulative transactions" },
                ]}
              />
              <ChartTooltip
                rows={(point) => [
                  {
                    color: "var(--chart-2)",
                    label: "Daily transactions",
                    value: compact.format(Number(point.transactions ?? 0)),
                  },
                  {
                    color: "var(--chart-1)",
                    label: "Cumulative transactions",
                    value: compact.format(Number(point.cumulativeTransactions ?? 0)),
                  },
                ]}
              />
            </BarChart>
          </TimeSeriesCard>
        ) : null}
        {sections.includes("spend-share") ? (
          <ProfilePie
            data={spendShare}
            label="Spend volume"
            moneyValues
            surface="secondary"
            totalLabel={money(data.spendUsd)}
          />
        ) : null}
      </div>
    </>
  );

  if (embedded) return content;
  return (
    <AnalyticsSection flushBottom={flushBottom} id="spend-analytics" subtitle={subtitle} title={title}>
      {content}
    </AnalyticsSection>
  );
}

export function AnalyticsCharts({
  data,
  flushTop = false,
  sections = ["profiles", "balances", "active-hours"],
  showProfileHeader = true,
}: {
  data: ExplorerData;
  flushTop?: boolean;
  sections?: AnalyticsSectionName[];
  showProfileHeader?: boolean;
}) {
  const hourly = data.hourly.map((row) => ({
    ...row,
    date: new Date(Date.UTC(2026, 0, 1, row.hour)),
    xLabel: `${String(row.hour).padStart(2, "0")}:00`,
  }));
  const countPie = data.spendProfiles.map((row, index) => ({
    label: row.bucket,
    value: row.spendCount,
    color: colors[index],
  }));
  const volumePie = data.spendProfiles.map((row, index) => ({
    label: row.bucket,
    value: row.spendUsd,
    color: colors[index],
  }));

  return (
    <>
      {sections.includes("profiles") ? (
        <AnalyticsSection
          flushTop={flushTop}
          id="profiles"
          subtitle={showProfileHeader ? "Settled spend grouped into seven USD ranges" : undefined}
          title={showProfileHeader ? "Transaction profiles" : undefined}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <ProfilePie data={countPie} label="Transaction share" totalLabel={compact.format(data.spendCount)} />
            <ProfilePie data={volumePie} label="Spend share" moneyValues totalLabel={money(data.spendUsd)} />
          </div>
        </AnalyticsSection>
      ) : null}

      {sections.includes("balances") ? (
        <AnalyticsSection
          id="balances"
          subtitle="Per-token destination credits minus settled spend debits"
          title="Derived destination balances"
        >
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-card">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/40 px-5 py-5 sm:px-6">
              <div>
                <span className="text-sm text-muted-foreground">Token balances</span>
                <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">Account activity</h3>
              </div>
              <span className="text-[11px] text-muted-foreground">
                ERC-20 decimals · current verified oracle price when available
              </span>
            </div>
            {data.balances.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="px-6 py-4 font-normal">Destination</th>
                      <th className="px-6 py-4 font-normal">Kind</th>
                      <th className="px-6 py-4 font-normal">Token</th>
                      <th className="px-6 py-4 text-right font-normal">Top-ups − spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.balances.slice(0, 8).map((row) => (
                      <tr className="border-t border-border/40" key={`${row.chainId}:${row.account}:${row.token}`}>
                        <td className="px-6 py-4 font-mono text-foreground">
                          <Link
                            className="underline decoration-muted-foreground/60 underline-offset-4 transition-colors hover:text-foreground"
                            href={`/accounts/${row.account}`}
                          >
                            {short(row.account)}
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">{row.accountKind.replaceAll("_", " ")}</td>
                        <td className="px-6 py-4 font-mono text-muted-foreground">
                          <span className="inline-flex items-center gap-2.5">
                            <TokenIcon address={row.token} chainId={row.chainId} symbol={row.symbol} />
                            <Link
                              className="underline decoration-muted-foreground/60 underline-offset-4 transition-colors hover:text-foreground"
                              href={`/tokens/${row.token}`}
                            >
                              {row.symbol || short(row.token)}
                            </Link>
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-foreground">{balanceValue(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ChartEmpty label="No positive derived destination balances match the current query" />
            )}
          </div>
        </AnalyticsSection>
      ) : null}

      {sections.includes("active-hours") ? (
        <AnalyticsSection id="active-hours" subtitle="Spend by hour of day (UTC)" title="Most active hours">
          <div className="grid gap-5 lg:grid-cols-2">
            <ScatterCard
              data={hourly}
              dataKey="spendCount"
              label="By Transaction Activity"
              valueFormatter={(value) => compact.format(value)}
            />
            <ScatterCard data={hourly} dataKey="spendUsd" label="By Spend Volume" valueFormatter={money} />
          </div>
        </AnalyticsSection>
      ) : null}
    </>
  );
}

export function TokenAnalyticsCharts({
  data,
  flushTop = false,
  showHeader = true,
  showTable = true,
}: {
  data: TokenAnalyticsRow[];
  flushTop?: boolean;
  showHeader?: boolean;
  showTable?: boolean;
}) {
  const colorByToken = new Map(data.map((row, index) => [tokenAnalyticsId(row), colors[index % colors.length]]));
  const safeBalances = tokenPieData(data, "reserveUsd", colorByToken);
  const spend = tokenPieData(data, "spendUsd", colorByToken);
  const topUps = tokenPieData(data, "topUpUsd", colorByToken);
  const withdrawals = tokenPieData(data, "withdrawalCount", colorByToken);
  const borrows = tokenPieData(data, "borrowedUsd", colorByToken);
  const repayments = tokenPieData(data, "repaidUsd", colorByToken);

  return (
    <AnalyticsSection flushTop={flushTop} id="token-analytics" title={showHeader ? "Tokens" : undefined}>
      <div className="grid gap-5 lg:grid-cols-2">
        <TokenPie data={safeBalances} label="Safe balances" moneyValues subtitle="by token · latest available price" />
        <TokenPie data={spend} label="Spend volume" moneyValues subtitle="by token" />
        <TokenPie data={topUps} label="Top-up volume" moneyValues subtitle="by token · latest available price" />
        <TokenPie
          centerLabel="Requests"
          data={withdrawals}
          label="Withdrawal requests"
          subtitle="by token · request count"
          totalSuffix="requests"
        />
        <TokenPie data={borrows} label="Borrow volume" moneyValues subtitle="by token" />
        <TokenPie data={repayments} label="Repayment volume" moneyValues subtitle="by token" />
      </div>
      {showTable ? <TokenFlowTable data={data} /> : null}
    </AnalyticsSection>
  );
}

function AnalyticsSection({
  children,
  flushBottom = false,
  flushTop = false,
  id,
  subtitle,
  title,
}: {
  children: ReactNode;
  flushBottom?: boolean;
  flushTop?: boolean;
  id: string;
  subtitle?: string;
  title?: string;
}) {
  const sectionClass =
    id === "spend-analytics"
      ? flushBottom
        ? "scroll-mt-24 pt-8 sm:pt-10"
        : "scroll-mt-24 py-8 sm:py-10"
      : flushTop
        ? "scroll-mt-24 pt-6 pb-8"
        : "mt-16 scroll-mt-24 border-t border-border pt-16";
  return (
    <section className={sectionClass} id={id}>
      {title ? (
        <>
          <h2 className="text-2xl font-normal tracking-[-.03em] text-foreground">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
        </>
      ) : null}
      <div className={title ? "mt-8" : ""}>{children}</div>
    </section>
  );
}
function TimeSeriesCard({
  children,
  duration,
  filename,
  label,
  total,
}: {
  children: ReactNode;
  duration: string;
  filename: string;
  label: string;
  total: string;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  return (
    <div className="overflow-hidden rounded-2xl bg-secondary/50 text-secondary-foreground">
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-muted-foreground">{label}</span>
          <ChartExportActions
            containerRef={chartContainerRef}
            filename={filename}
            title={`Ether.fi: ${label}`}
            value={`${total} (${duration})`}
          />
        </div>
        <AnimatedTotal value={total} />
      </div>
      <div className="mt-2" ref={chartContainerRef}>
        {children}
      </div>
    </div>
  );
}
function AnimatedTotal({ value }: { value: string }) {
  return (
    <TextMorph as="strong" className="mt-2 block text-2xl font-normal tracking-[-.03em] tabular-nums" duration={400}>
      {value}
    </TextMorph>
  );
}
function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="grid aspect-[2.1/1] place-items-center px-6 text-center text-sm text-muted-foreground">{label}</div>
  );
}

function ProfilePie({
  data,
  label,
  moneyValues = false,
  surface = "card",
  totalLabel,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  label: string;
  moneyValues?: boolean;
  surface?: "card" | "secondary";
  totalLabel: string;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const surfaceClass =
    surface === "secondary"
      ? "bg-secondary/50 text-secondary-foreground"
      : "border border-border/40 bg-card text-card-foreground";
  return (
    <article className={`rounded-2xl p-5 sm:p-6 ${surfaceClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">{label}</span>
          <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">by transaction group</h3>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename={`${slug(label)}.svg`}
          title={`Ether.fi: ${label}`}
          value={totalLabel}
        />
      </div>
      {data.length ? (
        <div className="mt-6 grid items-center gap-6 sm:grid-cols-[240px_minmax(0,1fr)]" ref={chartContainerRef}>
          <PieChart className="max-w-60" cornerRadius={3} data={data} innerRadius={72} padAngle={0.018}>
            <PieCenter defaultLabel="All" valueClassName="text-lg" />
            {data.map((row, index) => (
              <PieSlice color={row.color} hoverEffect="grow" index={index} key={row.label} />
            ))}
          </PieChart>
          <div className="chart-html-legend space-y-3">
            {data.map((row) => (
              <div
                className="flex items-center gap-3 text-xs"
                data-chart-legend-label={row.label}
                data-chart-legend-value={moneyValues ? money(row.value) : compact.format(row.value)}
                key={row.label}
              >
                <span className="chart-html-legend-swatch size-1.5 rounded-full" style={{ background: row.color }} />
                <span className="flex-1 text-muted-foreground">{row.label}</span>
                <span className="text-foreground">{moneyValues ? money(row.value) : compact.format(row.value)}</span>
              </div>
            ))}
            <div
              className="border-t border-border pt-3 text-right text-sm text-foreground"
              data-chart-legend-total={`All · ${totalLabel}`}
            >
              All · {totalLabel}
            </div>
          </div>
        </div>
      ) : (
        <div ref={chartContainerRef}>
          <ChartEmpty label="No spend distribution available yet" />
        </div>
      )}
    </article>
  );
}

function TokenPie({
  centerLabel,
  data,
  label,
  moneyValues = false,
  subtitle,
  totalSuffix,
}: {
  centerLabel?: string;
  data: Array<{ label: string; value: number; color: string }>;
  label: string;
  moneyValues?: boolean;
  subtitle: string;
  totalSuffix?: string;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const totalLabel = moneyValues ? money(total) : `${compact.format(total)}${totalSuffix ? ` ${totalSuffix}` : ""}`;
  return (
    <article className="rounded-2xl bg-secondary/50 p-5 text-secondary-foreground sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">{label}</span>
          <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">{subtitle}</h3>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename={`${slug(label)}.svg`}
          title={`Ether.fi: ${label} by token`}
          value={totalLabel}
        />
      </div>
      {data.length ? (
        <div className="mt-6 grid items-center gap-6 sm:grid-cols-[240px_minmax(0,1fr)]" ref={chartContainerRef}>
          <PieChart className="max-w-60" cornerRadius={3} data={data} innerRadius={72} padAngle={0.018}>
            <PieCenter
              defaultLabel={centerLabel ?? (moneyValues ? "USD" : "All")}
              prefix={moneyValues ? "$" : undefined}
              valueClassName="text-lg"
            />
            {data.map((row, index) => (
              <PieSlice color={row.color} hoverEffect="grow" index={index} key={row.label} />
            ))}
          </PieChart>
          <div className="chart-html-legend space-y-3">
            {data.map((row) => (
              <div
                className="flex items-center gap-3 text-xs"
                data-chart-legend-label={row.label}
                data-chart-legend-value={moneyValues ? money(row.value) : compact.format(row.value)}
                key={row.label}
              >
                <span className="chart-html-legend-swatch size-1.5 rounded-full" style={{ background: row.color }} />
                <span className="flex-1 text-muted-foreground">{row.label}</span>
                <span className="text-foreground">{moneyValues ? money(row.value) : compact.format(row.value)}</span>
              </div>
            ))}
            <div
              className="border-t border-border pt-3 text-right text-sm text-foreground"
              data-chart-legend-total={`All · ${totalLabel}`}
            >
              All · {totalLabel}
            </div>
          </div>
        </div>
      ) : (
        <div ref={chartContainerRef}>
          <ChartEmpty label={`No ${label.toLowerCase()} data available yet`} />
        </div>
      )}
    </article>
  );
}

function TokenFlowTable({ data }: { data: TokenAnalyticsRow[] }) {
  const rows = [...data].sort((a, b) => tokenActivity(b) - tokenActivity(a)).slice(0, 24);
  return (
    <article className="mt-5 overflow-hidden rounded-2xl border border-border/40 bg-card text-card-foreground">
      <div className="px-5 py-5 sm:px-6">
        <span className="text-sm font-semibold text-muted-foreground">Token flow ledger</span>
        <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">balances, deposits, credits, spend and debt</h3>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1660px] text-left text-sm font-medium text-foreground">
            <thead className="border-t border-border/40 text-foreground">
              <tr>
                <th className="px-6 py-4">Token</th>
                <th className="px-5 py-4 text-right">Safe balance</th>
                <th className="px-5 py-4 text-right">Spend</th>
                <th className="px-5 py-4 text-right">Top-ups</th>
                <th className="px-5 py-4 text-right">Safe deposits</th>
                <th className="px-5 py-4 text-right">Destination credits</th>
                <th className="px-5 py-4 text-right">Supplied</th>
                <th className="px-5 py-4 text-right">Borrowed</th>
                <th className="px-6 py-4 text-right">Repaid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-border/40" key={tokenAnalyticsId(row)}>
                  <td className="px-6 py-4">
                    <Link
                      aria-label={`View ${row.symbol || short(row.token)} token details on ${chainLabel(row.chainId)}`}
                      className="inline-flex items-center gap-3 rounded-lg outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/tokens/${row.token}`}
                    >
                      <span className="relative">
                        <TokenIcon address={row.token} chainId={row.chainId} symbol={row.symbol} />
                        <ChainBadge chainId={row.chainId} className="absolute -bottom-1 -right-1 size-3.5 ring-card" />
                      </span>
                      <span>
                        <span className="block font-medium text-foreground">{row.symbol || short(row.token)}</span>
                        {row.name ? (
                          <span className="mt-1 block text-sm font-medium text-muted-foreground">{row.name}</span>
                        ) : null}
                      </span>
                    </Link>
                  </td>
                  <MetricCell
                    primary={tokenValue(row.reserveBalance, row)}
                    secondary={row.reserveUsd === null ? "price unavailable" : money(row.reserveUsd)}
                  />
                  <MetricCell primary={money(row.spendUsd)} />
                  <MetricCell
                    primary={row.topUpUsd === null ? tokenValue(row.topUpAmount, row) : money(row.topUpUsd)}
                    secondary={tokenValue(row.topUpAmount, row)}
                  />
                  <MetricCell
                    primary={tokenValue(row.safeInflow, row)}
                    secondary={`${compact.format(row.safeAccountCount)} safes`}
                  />
                  <MetricCell primary={tokenValue(row.destinationCredits, row)} />
                  <MetricCell primary={tokenValue(row.suppliedAmount, row)} />
                  <MetricCell
                    primary={row.borrowedUsd > 0 ? money(row.borrowedUsd) : tokenValue(row.borrowedAmount, row)}
                    secondary={borrowValuationLabel(row.borrowedUsdStatus)}
                  />
                  <MetricCell
                    primary={row.repaidUsd > 0 ? money(row.repaidUsd) : tokenValue(row.repaidAmount, row)}
                    trailing
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ChartEmpty label="No token analytics are available for the current index" />
      )}
    </article>
  );
}

function MetricCell({
  primary,
  secondary,
  trailing = false,
}: {
  primary: string;
  secondary?: string;
  trailing?: boolean;
}) {
  return (
    <td className={`${trailing ? "px-6" : "px-5"} py-4 text-right`}>
      <span className="block whitespace-nowrap text-foreground">{primary}</span>
      {secondary ? (
        <span className="mt-1 block whitespace-nowrap text-sm text-muted-foreground">{secondary}</span>
      ) : null}
    </td>
  );
}

function ScatterCard({
  data,
  dataKey,
  label,
  valueFormatter,
}: {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  label: string;
  valueFormatter: (value: number) => string;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const total = data.reduce((sum, row) => sum + Number(row[dataKey] ?? 0), 0);
  return (
    <article className="overflow-hidden rounded-2xl border border-border/40 bg-card text-card-foreground">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">Most Active Hours (UTC)</span>
          <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">{label}</h3>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename={`${slug(label)}.svg`}
          title={`Ether.fi: ${label}`}
          value={valueFormatter(total)}
        />
      </div>
      <div ref={chartContainerRef}>
        {data.length ? (
          <ScatterChart
            aspectRatio="2.15 / 1"
            data={data}
            margin={{ top: 28, right: 18, bottom: 48, left: 18 }}
            xDataKey="date"
          >
            <Grid fadeHorizontal={false} numTicksRows={3} stroke="var(--chart-grid)" strokeOpacity={0.5} />
            <Scatter dataKey={dataKey} fill="var(--chart-1)" radius={4} />
            <XAxis numTicks={6} />
            <ChartTooltip
              rows={(point) => [{ color: "var(--chart-1)", label, value: valueFormatter(Number(point[dataKey] ?? 0)) }]}
            />
          </ScatterChart>
        ) : (
          <ChartEmpty label="No hourly spend available yet" />
        )}
      </div>
    </article>
  );
}
function money(value: number) {
  return `$${compact.format(value)}`;
}
function balanceValue(row: ExplorerData["balances"][number]) {
  if (row.decimals === null) return `${row.amount} raw`;
  try {
    const amount = Number(formatUnits(BigInt(row.amount), row.decimals));
    const token = `${compact.format(amount)} ${row.symbol || short(row.token)}`;
    return row.amountUsd === null ? token : `${token} · ${money(row.amountUsd)}`;
  } catch {
    return `${row.amount} raw`;
  }
}
function tokenAnalyticsId(row: Pick<TokenAnalyticsRow, "chainId" | "token">) {
  return `${row.chainId}:${row.token}`;
}
function borrowValuationLabel(status: TokenAnalyticsRow["borrowedUsdStatus"]) {
  if (status === "latest_indexed_price") return "latest available price";
  if (status === "latest_cross_chain_price") return "latest cross-chain price";
  if (status === "event_time") return "value at transaction time";
  return "price unavailable";
}
function tokenActivity(row: TokenAnalyticsRow) {
  return (
    row.spendCount + row.topUpCount + row.withdrawalCount + row.suppliedCount + row.borrowedCount + row.repaidCount
  );
}
function tokenPieData(
  data: TokenAnalyticsRow[],
  key: "reserveUsd" | "spendUsd" | "topUpUsd" | "withdrawalCount" | "borrowedUsd" | "repaidUsd",
  colorByToken: Map<string, string>,
) {
  const value = (row: TokenAnalyticsRow) => Number(row[key] ?? 0);
  const ranked = data.filter((row) => value(row) > 0).sort((a, b) => value(b) - value(a));
  const visible = ranked.slice(0, 6).map((row) => ({
    label: `${row.symbol || short(row.token)} · ${chainLabel(row.chainId)}`,
    value: value(row),
    color: colorByToken.get(tokenAnalyticsId(row)) ?? colors[0],
  }));
  const other = ranked.slice(6).reduce((sum, row) => sum + value(row), 0);
  return other > 0 ? [...visible, { label: "Other", value: other, color: "var(--chart-7)" }] : visible;
}
function tokenValue(value: string, row: Pick<TokenAnalyticsRow, "decimals" | "symbol" | "token">) {
  if (value === "0") return "—";
  if (row.decimals === null) return `${compact.format(Number(value))} raw`;
  try {
    return `${compact.format(Number(formatUnits(BigInt(value), row.decimals)))} ${row.symbol || short(row.token)}`;
  } catch {
    return `${value} raw`;
  }
}
function chainLabel(chainId: number) {
  return INDEXED_CHAIN_BY_ID.get(chainId)?.name ?? `Chain ${chainId}`;
}
function short(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
function slug(value: string) {
  return `etherfi-${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}
