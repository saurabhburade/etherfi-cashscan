"use client";

import Link from "next/link";
import { type ReactNode, useRef } from "react";
import { ChartExportActions } from "@/components/chart-export-actions";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { PieCenter } from "@/components/charts/pie-center";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { XAxis } from "@/components/charts/x-axis";
import type { ExplorerData } from "@/lib/envio";
import { shortAddress } from "@/lib/format";
import { effectiveTierCounts } from "@/lib/safe-tier";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const money = (value: number) => `$${compact.format(value)}`;
const number = (value: number) => compact.format(value);
const chartPrimary = "var(--chart-1)";
const chartSecondary = "var(--chart-2)";
const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

// Cash contracts encode these values as numeric IDs. Keep this presentation map
// in the explorer only; the indexer deliberately remains protocol-native.
const TIERS: Record<number, string> = { 0: "Core", 1: "Luxe", 2: "Pinnacle", 3: "VIP", 4: "Business" };
const MODES: Record<number, string> = { 0: "Credit", 1: "Debit" };
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
const value = (row: Record<string, unknown>, ...keys: string[]) =>
  keys.map((key) => row[key]).find((item) => item !== undefined && item !== null);
const numeric = (input: unknown) => {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
};
const label = (input: unknown) => String(input ?? "Unknown").replaceAll("_", " ");
const tier = (input: unknown) =>
  input === null || input === undefined ? "—" : (TIERS[numeric(input)] ?? `Tier ${String(input)}`);
const mode = (input: unknown) =>
  input === null || input === undefined ? "—" : (MODES[numeric(input)] ?? label(input));
const day = (row: Record<string, unknown>) =>
  String(value(row, "day", "date", "timestamp", "changedAt") ?? "").slice(0, 10);
const bool = (input: unknown) => input === true || input === "true" || input === 1 || input === "1";
type CashAccountSection =
  | "funding-mode"
  | "tiers"
  | "lend-adoption"
  | "credit-liabilities"
  | "cash-account-states"
  | "cash-operations";

export function CashAccountAnalytics({
  data,
  sections = ["funding-mode", "tiers", "lend-adoption", "credit-liabilities", "cash-account-states", "cash-operations"],
  showTables = true,
}: {
  data: ExplorerData;
  sections?: CashAccountSection[];
  showTables?: boolean;
}) {
  const tiers = records(data.tierDistribution);
  const transitions = records(data.tierTransitions);
  const modes = records(data.modeDistribution);
  const modeChanges = records(data.modeChanges);
  const safes = records(data.safeCashStates);
  const config = records(data.cashConfiguration);
  const lend = data.lendSummary;
  const pending = data.pendingActions;
  const modeSeries = dailyModeSeries(modeChanges);
  const tierSeries = dailyTierSeries(transitions);
  const modeChangeCount = modeChanges.reduce(
    (total, row) => total + numeric(value(row, "count", "modeChanges", "changeCount")),
    0,
  );
  const tierTransitionCount = tierSeries.reduce((total, row) => total + row.upgrades + row.segments, 0);
  const tierDistribution = effectiveTierCounts(
    tiers.map((row) => ({
      tierId: numeric(value(row, "tier", "tierId", "effectiveTier")),
      safeCount: numeric(value(row, "count", "safeCount")),
    })),
    data.activeCardCount,
  )
    .map((row) => ({
      color: chartColors[row.tierId % chartColors.length],
      label: tier(row.tierId),
      value: row.safeCount,
    }))
    .filter((row) => row.value > 0);
  const creditSpendUsd = data.creditSpendUsd;
  const debitSpendUsd = data.debitSpendUsd;
  const show = (section: CashAccountSection) => sections.includes(section);

  return (
    <>
      {show("funding-mode") ? (
        <ExplorerSection
          id="funding-mode"
          title="Funding mode"
          subtitle="Credit and debit are Cash funding modes, not physical card types. Network selection applies to these indexed event metrics."
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,.8fr)]">
            <Trend
              title="Credit vs debit mode changes"
              value={number(modeChangeCount)}
              hasData={modeSeries.some((row) => row.credit || row.debit)}
              empty="No funding-mode changes have been indexed for this network scope yet."
            >
              <BarChart
                aspectRatio="2.4 / 1"
                barGap={0.24}
                data={modeSeries}
                margin={{ top: 24, right: 18, bottom: 38, left: 18 }}
                xDataKey="date"
              >
                <Grid fadeHorizontal={false} numTicksRows={4} />
                <Bar dataKey="credit" fill={chartPrimary} lineCap={3} />
                <Bar dataKey="debit" fill={chartSecondary} lineCap={3} />
                <BarXAxis maxLabels={5} />
                <ChartTooltip
                  rows={(point) => [
                    { color: chartPrimary, label: "Changes to Credit", value: number(numeric(point.credit)) },
                    { color: chartSecondary, label: "Changes to Debit", value: number(numeric(point.debit)) },
                  ]}
                />
              </BarChart>
            </Trend>
            <Definitions title="Mode KPIs">
              <Definition label="Credit spend" value={money(creditSpendUsd)} />
              <Definition label="Debit spend" value={money(debitSpendUsd)} />
              <Definition label="Mode-change events" value={number(modeChangeCount)} />
            </Definitions>
          </div>
          <CompactTable
            title="Current funding-mode distribution"
            empty="No effective Cash funding modes have been indexed yet."
            headings={["Mode", "Safes"]}
            rows={modes.map((row) => [
              mode(value(row, "modeId", "mode", "fundingMode", "effectiveMode")),
              number(numeric(value(row, "count", "safeCount"))),
            ])}
          />
        </ExplorerSection>
      ) : null}

      {show("tiers") ? (
        <ExplorerSection
          id="tiers"
          title="Cash tiers"
          subtitle="Tier IDs are mapped in this frontend: 0 Core, 1 Luxe, 2 Pinnacle, 3 VIP, 4 Business. Business transitions are shown as segment changes, never upgrades."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Trend
              title="Tier upgrades & segment changes"
              value={number(tierTransitionCount)}
              hasData={tierSeries.some((row) => row.upgrades > 0 || row.segments > 0)}
              empty="No tier-transition history has been indexed yet."
            >
              <AreaChart
                aspectRatio="2.25 / 1"
                data={tierSeries}
                margin={{ top: 24, right: 18, bottom: 38, left: 18 }}
                xDataKey="date"
              >
                <Grid fadeHorizontal={false} numTicksRows={4} />
                <Area
                  dataKey="upgrades"
                  fill={chartPrimary}
                  fillOpacity={0.08}
                  showHighlight
                  stroke={chartPrimary}
                  strokeWidth={2}
                />
                <Area
                  dataKey="segments"
                  fill={chartSecondary}
                  fillOpacity={0.04}
                  showHighlight
                  stroke={chartSecondary}
                  strokeWidth={1.5}
                />
                <XAxis numTicks={5} />
                <ChartTooltip
                  rows={(point) => [
                    { color: chartPrimary, label: "Upgrades", value: number(numeric(point.upgrades)) },
                    {
                      color: chartSecondary,
                      label: "Business segment changes",
                      value: number(numeric(point.segments)),
                    },
                  ]}
                />
              </AreaChart>
            </Trend>
            <TierDistribution data={tierDistribution} />
          </div>
          {showTables ? (
            <CompactTable
              title="Recent tier transitions"
              empty="No tier transitions are available for this network scope."
              headings={["From", "To", "Classification", "Events"]}
              rows={transitions.slice(0, 12).map((row) => {
                const from = value(row, "fromTierId", "fromTier", "previousTier");
                const to = value(row, "toTierId", "toTier", "nextTier", "tier");
                return [
                  tier(from),
                  tier(to),
                  isSegmentChange(row) ? "Business segment" : isUpgrade(row) ? "Upgrade" : "Change",
                  number(numeric(value(row, "count", "transitionCount"))),
                ];
              })}
            />
          ) : null}
        </ExplorerSection>
      ) : null}

      {show("lend-adoption") ? (
        <ExplorerSection
          id="lend-adoption"
          title="Lend adoption & pending actions"
          subtitle="Lend state is event-backed Cash account state. Pending entries are requested actions, not completed changes."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Definitions title="Lend adoption">
              <Definition label="Lend active" value={number(lend.active)} />
              <Definition label="Opted out" value={number(lend.optedOut)} />
              <Definition label="Pending opt-outs" value={number(lend.pendingOptOut)} />
            </Definitions>
            <Definitions title="Pending action queue">
              <Definition label="Withdrawals" value={number(pending.withdrawals)} />
              <Definition label="Cashback value" value={money(pending.cashbackUsd)} />
              <Definition label="Mode changes" value={number(pending.modeChanges)} />
              <Definition label="Limit changes" value={number(pending.spendingLimitChanges)} />
              <Definition label="Lend opt-outs" value={number(pending.lendOptOuts)} />
            </Definitions>
          </div>
        </ExplorerSection>
      ) : null}

      {show("credit-liabilities") ? (
        <ExplorerSection
          id="credit-liabilities"
          title="Credit liabilities"
          subtitle="Borrow and repay are principal / event-time USD metrics. Cash events alone cannot reconstruct the exact accrued Aave payoff for a Safe."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Definitions title="Indexed liability metrics">
              <Definition label="Borrowed (event USD)" value={money(data.borrowedUsd)} />
              <Definition label="Repaid (event USD)" value={money(data.repaidUsd)} />
              <Definition label="Outstanding (derived)" value={money(data.outstandingDebtUsd)} />
              <Definition label="Borrowers" value={number(data.borrowerCount)} />
            </Definitions>
            <Definitions title="Interpretation boundary">
              <Definition label="Principal / event USD" value="Indexed and shown" />
              <Definition label="Exact accrued payoff" value="Requires lending-state reconstruction" />
              <Definition label="Cash-only conclusion" value="Not an exact Aave debt quote" />
            </Definitions>
          </div>
        </ExplorerSection>
      ) : null}

      {show("cash-account-states") && showTables ? (
        <ExplorerSection
          id="cash-account-states"
          title="Safe account states"
          subtitle="A Safe is an on-chain account, not a unique person. Values are the latest indexed Cash state and can be pending protocol actions."
        >
          <StateTable rows={safes} />
        </ExplorerSection>
      ) : null}

      {show("cash-operations") ? (
        <ExplorerSection
          id="cash-operations"
          title="Cash operations & configuration"
          subtitle="Operational counters reflect indexed protocol events. Configuration is the observed protocol configuration, not a recommendation or product offer."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Definitions title="Operations">
              <Definition label="Collateral resupplies" value={number(data.collateralResupplyCount)} />
              <Definition label="Lend supply failures" value={number(data.lendSupplyFailureCount)} />
              <Definition label="Exact accrued Aave debt" value="Not derivable from Cash events" />
            </Definitions>
            <Definitions title="Boundaries">
              <Definition label="Merchant / MCC" value="Not indexed" />
              <Definition label="Pending authorizations" value="Not indexed" />
              <Definition label="Safe identity" value="Not a unique person" />
            </Definitions>
          </div>
          {showTables ? (
            <CompactTable
              title="Protocol configuration"
              empty="No Cash configuration snapshots have been indexed yet."
              headings={["Setting", "Observed value"]}
              rows={config.map((row) => [
                label(value(row, "key", "name", "setting", "parameter")),
                label(value(row, "value", "displayValue", "currentValue")),
              ])}
            />
          ) : null}
        </ExplorerSection>
      ) : null}
    </>
  );
}

export function EffectiveTierDistribution({
  data,
  totalSafeCount,
}: {
  data: ExplorerData["tierDistribution"];
  totalSafeCount: number;
}) {
  const distribution = effectiveTierCounts(data, totalSafeCount)
    .map((row) => ({
      color: chartColors[row.tierId % chartColors.length],
      label: tier(row.tierId),
      value: row.safeCount,
    }))
    .filter((row) => row.value > 0);

  return <TierDistribution data={distribution} />;
}

function isSegmentChange(row: Record<string, unknown>) {
  const from = value(row, "fromTierId", "fromTier", "previousTier");
  const to = value(row, "toTierId", "toTier", "nextTier", "tier");
  if (from === null || from === undefined || to === null || to === undefined) return false;
  return numeric(from) === 4 || numeric(to) === 4;
}
function isUpgrade(row: Record<string, unknown>) {
  const fromValue = value(row, "fromTierId", "fromTier", "previousTier");
  const toValue = value(row, "toTierId", "toTier", "nextTier", "tier");
  if (fromValue === null || fromValue === undefined || toValue === null || toValue === undefined) return false;
  const from = numeric(fromValue);
  const to = numeric(toValue);
  return from < to && from !== 4 && to !== 4;
}
function dailyModeSeries(rows: Record<string, unknown>[]) {
  const points = new Map<string, { date: Date; credit: number; debit: number }>();
  for (const row of rows) {
    const dateKey = day(row);
    if (!dateKey) continue;
    const count = numeric(value(row, "count", "modeChanges", "changeCount"));
    const modeId = numeric(value(row, "newModeId", "modeId", "mode"));
    const point = points.get(dateKey) ?? { date: new Date(`${dateKey}T00:00:00Z`), credit: 0, debit: 0 };
    if (modeId === 0) point.credit += count;
    if (modeId === 1) point.debit += count;
    points.set(dateKey, point);
  }
  return [...points.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}
function dailyTierSeries(rows: Record<string, unknown>[]) {
  const points = new Map<string, { date: Date; upgrades: number; segments: number }>();
  for (const row of rows) {
    const dateKey = day(row);
    if (!dateKey) continue;
    const upgrade = isUpgrade(row);
    const segment = isSegmentChange(row);
    if (!(upgrade || segment)) continue;
    const count = numeric(value(row, "count", "transitionCount"));
    const point = points.get(dateKey) ?? { date: new Date(`${dateKey}T00:00:00Z`), upgrades: 0, segments: 0 };
    if (upgrade) point.upgrades += count;
    if (segment) point.segments += count;
    points.set(dateKey, point);
  }
  return [...points.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}
function ExplorerSection({
  children,
  id,
  subtitle,
  title,
}: {
  children: ReactNode;
  id: string;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="mt-16 scroll-mt-24 border-t border-border pt-16" id={id}>
      <h2 className="text-2xl font-normal tracking-[-.03em]">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </section>
  );
}
function Trend({
  children,
  empty,
  hasData,
  title,
  value: total,
}: {
  children: ReactNode;
  empty: string;
  hasData: boolean;
  title: string;
  value: string;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
      <div className="px-5 pt-5 sm:px-6">
        <span className="text-sm text-muted-foreground">{title}</span>
        <strong className="mt-2 block text-2xl font-normal tracking-[-.03em]">{total}</strong>
      </div>
      {hasData ? (
        <div className="mt-2">{children}</div>
      ) : (
        <div className="grid aspect-[2.25/1] place-items-center px-6 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      )}
    </article>
  );
}
function Definitions({ children, title }: { children: ReactNode; title: string }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
      <span className="text-sm text-muted-foreground">{title}</span>
      <div className="mt-5">{children}</div>
    </article>
  );
}
function Definition({ label: name, value: output }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{name}</span>
      <span className="font-mono text-right text-sm text-foreground">{output}</span>
    </div>
  );
}
function TierDistribution({ data }: { data: Array<{ color: string; label: string; value: number }> }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <article className="rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-normal tracking-[-.02em]">Effective tier distribution</h3>
        {data.length ? (
          <ChartExportActions
            containerRef={chartContainerRef}
            filename="etherfi-effective-tier-distribution.svg"
            title="Ether.fi: Effective tier distribution"
            value={number(total)}
          />
        ) : null}
      </div>
      {data.length ? (
        <div className="mt-6 grid items-center gap-6 sm:grid-cols-[240px_minmax(0,1fr)]" ref={chartContainerRef}>
          <PieChart className="mx-auto max-w-60" cornerRadius={3} data={data} innerRadius={72} padAngle={0.018}>
            <PieCenter defaultLabel="Safes" valueClassName="text-lg" />
            {data.map((row, index) => (
              <PieSlice color={row.color} hoverEffect="grow" index={index} key={row.label} />
            ))}
          </PieChart>
          <div className="chart-html-legend space-y-3">
            {data.map((row) => (
              <div
                className="flex items-center gap-3 text-xs"
                data-chart-legend-label={row.label}
                data-chart-legend-value={number(row.value)}
                key={row.label}
              >
                <span className="chart-html-legend-swatch size-1.5 rounded-full" style={{ background: row.color }} />
                <span className="flex-1 text-muted-foreground">{row.label}</span>
                <span className="font-mono text-foreground">{number(row.value)}</span>
              </div>
            ))}
            <div
              className="border-t border-border pt-3 text-right text-sm text-foreground"
              data-chart-legend-total={`All · ${number(total)}`}
            >
              All · {number(total)}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-muted-foreground">
          No Safe tier states have been indexed yet.
        </div>
      )}
    </article>
  );
}
function CompactTable({
  empty,
  headings,
  rows,
  title,
}: {
  empty: string;
  headings: string[];
  rows: string[][];
  title: string;
}) {
  return (
    <article className="mt-5 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
      <h3 className="px-5 py-5 text-lg font-normal tracking-[-.02em] sm:px-6">{title}</h3>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-y border-border text-xs text-muted-foreground">
              <tr>
                {headings.map((heading, index) => (
                  <th className={`px-6 py-3 font-normal ${index ? "text-right" : ""}`} key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr className="border-b border-border last:border-0" key={`${title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      className={`px-6 py-4 ${cellIndex ? "text-right font-mono text-foreground" : "text-foreground"}`}
                      key={cellIndex}
                    >
                      {cell}
                    </td>
                  ))}
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
function StateTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length)
    return (
      <article className="rounded-2xl border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No Safe Cash-state snapshots have been indexed for this network scope yet.
      </article>
    );
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <caption className="px-5 py-5 text-left text-lg font-normal tracking-[-.02em] sm:px-6">
            Latest indexed Safe Cash state
          </caption>
          <thead className="border-y border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-6 py-3 font-normal">Safe</th>
              <th className="px-6 py-3 font-normal">Tier</th>
              <th className="px-6 py-3 font-normal">Mode</th>
              <th className="px-6 py-3 font-normal">Lend</th>
              <th className="px-6 py-3 text-right font-normal">Limit usage</th>
              <th className="px-6 py-3 text-right font-normal">Pending withdrawal</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row, index) => {
              const account = String(value(row, "safe", "safeAddress", "account", "address") ?? "—");
              const effective = mode(value(row, "currentModeId", "effectiveMode", "mode", "fundingMode"));
              const pendingMode = value(row, "pendingModeId", "pendingMode", "requestedMode");
              return (
                <tr className="border-b border-border last:border-0" key={`${account}-${index}`}>
                  <td className="px-6 py-4 font-mono text-foreground">
                    {account.startsWith("0x") ? (
                      <Link
                        className="underline decoration-foreground/40 underline-offset-4 transition hover:opacity-70"
                        href={`/accounts/${account}`}
                      >
                        {shortAddress(account)}
                      </Link>
                    ) : (
                      account
                    )}
                  </td>
                  <td className="px-6 py-4 text-foreground">{tier(value(row, "tier", "tierId", "effectiveTier"))}</td>
                  <td className="px-6 py-4 text-foreground">
                    {effective}
                    {pendingMode !== undefined && pendingMode !== null ? (
                      <span className="block text-xs text-muted-foreground">pending {mode(pendingMode)}</span>
                    ) : null}
                  </td>
                  <td className="px-6 py-4 text-foreground">{label(value(row, "lendStatus", "lend", "lendState"))}</td>
                  <td className="px-6 py-4 text-right font-mono text-foreground">{formatUsage(row)}</td>
                  <td className="px-6 py-4 text-right font-mono text-foreground">
                    {bool(value(row, "pendingWithdrawal", "hasPendingWithdrawal"))
                      ? "Pending"
                      : label(value(row, "pendingWithdrawalAmount", "withdrawalAmount") ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
function formatUsage(row: Record<string, unknown>) {
  const today = value(row, "spentTodayUsd");
  const dailyLimit = value(row, "dailyLimitUsd");
  const month = value(row, "spentThisMonthUsd");
  const monthlyLimit = value(row, "monthlyLimitUsd");
  if (today !== undefined || dailyLimit !== undefined || month !== undefined || monthlyLimit !== undefined)
    return `D ${money(numeric(today))} / ${money(numeric(dailyLimit))} · M ${money(numeric(month))} / ${money(numeric(monthlyLimit))}`;
  const used = value(row, "spendingLimitUsedUsd", "limitUsedUsd", "spendingLimitUsed");
  const limit = value(row, "spendingLimitUsd", "limitUsd", "spendingLimit");
  if (used === undefined && limit === undefined) return "—";
  return `${money(numeric(used))} / ${money(numeric(limit))}`;
}
