"use client";

import { useRef } from "react";
import { ChartExportActions } from "@/components/chart-export-actions";
import { Area } from "@/components/charts/area-chart";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { CartesianXAxis, CartesianYAxis, ChartLegend } from "@/components/charts/cartesian-axis";
import { Grid } from "@/components/charts/grid";
import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { AccountAnalyticsDetail } from "@/lib/account-analytics";
import {
  type AccountChartSlice,
  accountCashbackTypeSlices,
  accountDailyChartPoints,
  accountFundingSlices,
  accountPortfolioSlices,
  accountTokenMetricSlices,
} from "@/lib/account-chart-data";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const money = (value: number) => `$${compact.format(value)}`;
const doughnutValueFormat = { notation: "compact" as const, maximumFractionDigits: 2 };

export function AccountAnalyticsCharts({ detail }: { detail: AccountAnalyticsDetail }) {
  const portfolio = accountPortfolioSlices(detail);
  const funding = accountFundingSlices(detail);
  const cashbackTypes = accountCashbackTypeSlices(detail);
  const safeInflows = accountTokenMetricSlices(detail, "safeInflowUsd");
  const deposits = accountTokenMetricSlices(detail, "depositedUsd");
  const spend = accountTokenMetricSlices(detail, "spentUsd");
  const withdrawals = accountTokenMetricSlices(detail, "withdrawnUsd");
  const cashback = accountTokenMetricSlices(detail, "cashbackUsd");
  const daily = accountDailyChartPoints(detail);
  const hasUnpricedPortfolio = detail.tokens.some(
    (row) => row.currentBalanceAmount !== "0" && row.currentBalanceUsd === null,
  );
  const unpriced = {
    safeInflows: hasUnpricedTokenMetric(detail, "safeInflowAmount", "safeInflowUsd"),
    deposits: hasUnpricedTokenMetric(detail, "depositedAmount", "depositedUsd"),
    spend: hasUnpricedTokenMetric(detail, "spentAmount", "spentUsd"),
    withdrawals: hasUnpricedTokenMetric(detail, "withdrawnAmount", "withdrawnUsd"),
    cashback: hasUnpricedTokenMetric(detail, "cashbackAmount", "cashbackUsd"),
  };

  return (
    <section className="mt-16 scroll-mt-24 border-t border-border pt-16" id="account-charts">
      <h2 className="text-2xl font-normal tracking-[-.03em] text-foreground">Account charts</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Portfolio uses latest indexed prices. Cash flows use event-time USD and remain separate from Safe transfers.
      </p>
      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <AccountDoughnut
          data={portfolio}
          empty="No priced token balances are available for this account."
          label="Portfolio allocation"
          note={hasUnpricedPortfolio ? "Unpriced token balances are excluded." : "Latest indexed token prices."}
          subtitle="by token"
        />
        <AccountDoughnut
          data={safeInflows}
          empty="No priced Safe inflows are available for this account."
          label="Safe inflow distribution"
          note={unpriced.safeInflows ? "Unpriced token inflows are excluded." : "Latest indexed token prices."}
          subtitle="by token"
        />
        <AccountDoughnut
          data={deposits}
          empty="No priced Cash top-ups are available for this account."
          label="Cash top-up distribution"
          note={unpriced.deposits ? "Unpriced token deposits are excluded." : "Cash TopUp event-time USD."}
          subtitle="by token"
        />
        <AccountDoughnut
          data={spend}
          empty="No priced spend is available for this account."
          label="Spend distribution"
          note={unpriced.spend ? "Unpriced token spend is excluded." : "Spend event-time USD."}
          subtitle="by token"
        />
        <AccountDoughnut
          data={withdrawals}
          empty="No priced withdrawals are available for this account."
          label="Withdrawal distribution"
          note={unpriced.withdrawals ? "Unpriced token withdrawals are excluded." : "Withdrawal event-time USD."}
          subtitle="by token"
        />
        <AccountDoughnut
          data={cashback}
          empty="No priced received cashback is available for this account."
          label="Received cashback distribution"
          note={
            unpriced.cashback ? "Unpriced token cashback is excluded." : "Paid and cleared cashback · event-time USD."
          }
          subtitle="by token"
        />
        <AccountDoughnut
          data={cashbackTypes}
          empty="No priced generated cashback is available for this account."
          label="Generated cashback by type"
          subtitle="by reward type"
        />
        <AccountDoughnut
          data={funding}
          empty="No credit or debit spend is indexed for this account."
          label="Spend funding mode"
          note="Cash mode 0 is Credit; mode 1 is Debit."
          subtitle="credit vs debit"
        />
        <DailyCashFlowChart data={daily} />
      </div>
    </section>
  );
}

function hasUnpricedTokenMetric(
  detail: AccountAnalyticsDetail,
  amountKey: "safeInflowAmount" | "depositedAmount" | "spentAmount" | "withdrawnAmount" | "cashbackAmount",
  usdKey: "safeInflowUsd" | "depositedUsd" | "spentUsd" | "withdrawnUsd" | "cashbackUsd",
) {
  return detail.tokens.some((row) => row[amountKey] !== "0" && row[usdKey] === null);
}

function AccountDoughnut({
  data,
  empty,
  label,
  note,
  subtitle,
}: {
  data: AccountChartSlice[];
  empty: string;
  label: string;
  note?: string;
  subtitle: string;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <article className="rounded-2xl bg-secondary/50 p-5 text-secondary-foreground sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">{label}</span>
          <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">{subtitle}</h3>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename={`etherfi-${label.toLowerCase().replaceAll(" ", "-")}.svg`}
          title={`Ether.fi: ${label}`}
          value={money(total)}
        />
      </div>
      {data.length ? (
        <div className="mt-6 grid items-center gap-6 sm:grid-cols-[240px_minmax(0,1fr)]" ref={chartContainerRef}>
          <PieChart className="max-w-60" cornerRadius={3} data={data} innerRadius={72} padAngle={0.018}>
            <PieCenter defaultLabel="USD" formatOptions={doughnutValueFormat} prefix="$" valueClassName="text-lg" />
            {data.map((row, index) => (
              <PieSlice color={row.color} hoverEffect="grow" index={index} key={row.label} />
            ))}
          </PieChart>
          <div className="chart-html-legend space-y-3">
            {data.map((row) => (
              <div
                className="flex items-center gap-3 text-xs"
                data-chart-legend-label={row.label}
                data-chart-legend-value={money(row.value)}
                key={row.label}
              >
                <span className="chart-html-legend-swatch size-1.5 rounded-full" style={{ background: row.color }} />
                <span className="flex-1 text-muted-foreground">{row.label}</span>
                <span className="text-foreground">{money(row.value)}</span>
              </div>
            ))}
            <div
              className="border-t border-border pt-3 text-right text-sm text-foreground"
              data-chart-legend-total={`All · ${money(total)}`}
            >
              All · {money(total)}
            </div>
            {note ? <p className="text-right text-xs text-muted-foreground">{note}</p> : null}
          </div>
        </div>
      ) : (
        <div
          className="grid aspect-[2.1/1] place-items-center px-6 text-center text-sm text-muted-foreground"
          ref={chartContainerRef}
        >
          {empty}
        </div>
      )}
    </article>
  );
}

function DailyCashFlowChart({ data }: { data: ReturnType<typeof accountDailyChartPoints> }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const total = data.at(-1)?.cumulativeVolumeUsd ?? 0;
  const hasUnpriced = data.some((row) => row.hasUnpricedFlow);
  return (
    <article className="overflow-hidden rounded-2xl bg-secondary/50 text-secondary-foreground lg:col-span-2">
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div>
          <span className="text-sm font-semibold text-muted-foreground">Cash Flow Volume</span>
          <h3 className="mt-2 text-xl font-normal tracking-[-.03em]">{money(total)}</h3>
        </div>
        <ChartExportActions
          containerRef={chartContainerRef}
          filename="etherfi-account-daily-cash-flows.svg"
          title="Ether.fi: Daily account volume"
          value={money(total)}
        />
      </div>
      {data.length ? (
        <div className="mt-2" ref={chartContainerRef}>
          <BarChart
            aspectRatio="3 / 1"
            barGap={0.2}
            data={data}
            margin={{ top: 24, right: 18, bottom: 72, left: 64 }}
            xDataKey="date"
          >
            <Grid fadeHorizontal={false} numTicksRows={5} stroke="var(--chart-grid)" yAxisId="cumulative" />
            <Bar dataKey="depositedUsd" fill="var(--chart-1)" lineCap={3} />
            <Bar dataKey="spentUsd" fill="var(--chart-2)" lineCap={3} />
            <Bar dataKey="withdrawnUsd" fill="var(--chart-4)" lineCap={3} />
            <Bar dataKey="cashbackUsd" fill="var(--chart-5)" lineCap={3} />
            <Bar dataKey="borrowedUsd" fill="var(--chart-6)" lineCap={3} />
            <Bar dataKey="repaidUsd" fill="var(--chart-7)" lineCap={3} />
            <Area
              dataKey="cumulativeVolumeUsd"
              fill="var(--chart-3)"
              fillOpacity={0.08}
              showHighlight
              stroke="var(--chart-3)"
              strokeWidth={2}
              yAxisId="cumulative"
            />
            <CartesianYAxis tickFormatter={money} yAxisId="cumulative" />
            <CartesianXAxis numTicks={3} />
            <ChartLegend
              items={[
                { color: "var(--chart-1)", label: "Deposits / top-ups" },
                { color: "var(--chart-2)", label: "Spend" },
                { color: "var(--chart-4)", label: "Withdrawals" },
                { color: "var(--chart-5)", label: "Cashback" },
                { color: "var(--chart-6)", label: "Borrowed" },
                { color: "var(--chart-7)", label: "Repaid" },
                { color: "var(--chart-3)", label: "Cumulative volume" },
              ]}
            />
            <ChartTooltip
              rows={(point) => [
                {
                  color: "var(--chart-1)",
                  label: "Deposits / top-ups",
                  value: money(Number(point.depositedUsd ?? 0)),
                },
                { color: "var(--chart-2)", label: "Spend", value: money(Number(point.spentUsd ?? 0)) },
                {
                  color: "var(--chart-4)",
                  label: "Withdrawals",
                  value: money(Number(point.withdrawnUsd ?? 0)),
                },
                { color: "var(--chart-5)", label: "Cashback", value: money(Number(point.cashbackUsd ?? 0)) },
                { color: "var(--chart-6)", label: "Borrowed", value: money(Number(point.borrowedUsd ?? 0)) },
                { color: "var(--chart-7)", label: "Repaid", value: money(Number(point.repaidUsd ?? 0)) },
                {
                  color: "var(--chart-3)",
                  label: "Cumulative volume",
                  value: money(Number(point.cumulativeVolumeUsd ?? 0)),
                },
              ]}
            />
          </BarChart>
          {hasUnpriced ? (
            <p className="px-5 pb-5 text-xs text-amber-500 sm:px-6">Some daily flows are unpriced and omitted.</p>
          ) : null}
        </div>
      ) : (
        <div
          className="grid aspect-[2.1/1] place-items-center px-6 text-center text-sm text-muted-foreground"
          ref={chartContainerRef}
        >
          No daily Cash flows are indexed for this account.
        </div>
      )}
    </article>
  );
}
