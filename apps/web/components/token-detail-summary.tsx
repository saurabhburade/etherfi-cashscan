import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import Link from "next/link";
import { ChainBadge } from "@/components/chain-badge";
import { TokenIcon } from "@/components/token-icon";
import type { TokenAnalyticsRow } from "@/lib/envio";
import { shortAddress } from "@/lib/format";
import { tokenMetricSummary } from "@/lib/token-metric-summary";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function TokenDetailSummary({ rows }: { rows: TokenAnalyticsRow[] }) {
  const token = rows[0];
  const chainIds = [...new Set(rows.map((row) => row.chainId))];
  const safeBalance = tokenMetricSummary(rows, "reserveBalance", "reserveUsd");
  const topUps = tokenMetricSummary(rows, "topUpAmount", "topUpUsd");
  const borrowStatuses = new Set(rows.filter((row) => row.borrowedCount > 0).map((row) => row.borrowedUsdStatus));
  const borrowValuation = borrowStatuses.has("unpriced")
    ? "USD price unavailable"
    : borrowStatuses.has("latest_cross_chain_price")
      ? "latest cross-chain price"
      : borrowStatuses.has("latest_indexed_price")
        ? "latest indexed price"
        : "event-time USD";
  const metrics = [
    {
      label: "Safe balance",
      value: safeBalance.usd === null ? safeBalance.tokenAmount : money.format(safeBalance.usd),
      detail: metricDetail(
        `${compact.format(rows.reduce((total, row) => total + row.safeAccountCount, 0))} safes`,
        safeBalance.usd,
      ),
    },
    {
      label: "Spend volume",
      value: money.format(rows.reduce((total, row) => total + row.spendUsd, 0)),
      detail: `${compact.format(rows.reduce((total, row) => total + row.spendCount, 0))} events`,
    },
    {
      label: "Top-up volume",
      value: topUps.usd === null ? topUps.tokenAmount : money.format(topUps.usd),
      detail: metricDetail(
        `${compact.format(rows.reduce((total, row) => total + row.topUpCount, 0))} events`,
        topUps.usd,
      ),
    },
    {
      label: "Borrowed",
      value: money.format(rows.reduce((total, row) => total + row.borrowedUsd, 0)),
      detail: `${compact.format(rows.reduce((total, row) => total + row.borrowedCount, 0))} events · ${borrowValuation}`,
    },
    {
      label: "Repaid",
      value: money.format(rows.reduce((total, row) => total + row.repaidUsd, 0)),
      detail: `${compact.format(rows.reduce((total, row) => total + row.repaidCount, 0))} events`,
    },
    {
      label: "Withdrawals",
      value: compact.format(rows.reduce((total, row) => total + row.withdrawalCount, 0)),
      detail: "requests",
    },
  ];

  return (
    <>
      <section className="pt-6 sm:pt-8">
        <Link
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          href="/tokens"
        >
          Tokens / {token.symbol || shortAddress(token.token)}
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <TokenIcon address={token.token} chainId={token.chainId} className="size-14 text-xs" symbol={token.symbol} />
          <div>
            <h1 className="text-2xl font-normal tracking-[-.03em] text-foreground">
              {token.name || token.symbol || shortAddress(token.token)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {token.symbol ? `${token.symbol} · ` : ""}
              {chainIds.length} {chainIds.length === 1 ? "network" : "networks"} · cumulative indexed activity
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {chainIds.map((chainId) => (
              <span
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
                key={chainId}
              >
                <ChainBadge chainId={chainId} className="size-4" />
                {INDEXED_CHAIN_BY_ID.get(chainId)?.name ?? `Chain ${chainId}`}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Cumulative token metrics" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <article className="rounded-2xl bg-secondary/50 p-5 text-secondary-foreground" key={metric.label}>
            <span className="text-xs font-semibold text-muted-foreground">{metric.label}</span>
            <strong className="mt-3 block text-2xl font-normal tracking-[-.03em]">{metric.value}</strong>
            <span className="mt-1 block text-xs text-muted-foreground">{metric.detail}</span>
          </article>
        ))}
      </section>
    </>
  );
}

function metricDetail(label: string, usd: number | null) {
  return usd === null ? `${label} · USD price unavailable` : label;
}
