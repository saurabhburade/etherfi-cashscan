import { explorerAddressUrl, INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { ChainBadge } from "@/components/chain-badge";
import { SafeTierImage } from "@/components/safe-tier-image";
import type { AccountAnalyticsDetail } from "@/lib/account-analytics";
import { shortAddress, timeAgo } from "@/lib/format";
import { safeTierName } from "@/lib/safe-tier";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

export function AccountDetailSummary({ detail, safe }: { detail: AccountAnalyticsDetail; safe: string }) {
  const account = detail.account;
  if (!account) return null;
  const hasUnpricedPositions = account.currentBalanceUsd === null && account.unpricedPositionCount > 0;
  const displayedBalanceUsd = account.currentBalanceUsd ?? account.pricedBalanceUsd;
  const displayedNetWorthUsd =
    account.netWorthUsd ??
    (account.eventLedgerOutstandingDebtUsd === null
      ? null
      : account.pricedBalanceUsd - account.eventLedgerOutstandingDebtUsd);
  const unpricedDetail = `${account.unpricedPositionCount} unpriced token ${account.unpricedPositionCount === 1 ? "position" : "positions"}`;
  const metrics = [
    {
      label: "Cash top-ups",
      value: usd(account.lifetimeDepositedUsd),
      detail: "Cash TopUp events · event-time USD",
    },
    {
      label: "Spend volume",
      value: usd(account.lifetimeSpentUsd),
      detail: `${usd(account.creditSpendUsd)} credit · ${usd(account.debitSpendUsd)} debit`,
    },
    {
      label: "Cashback received",
      value: usd(account.lifetimeCashbackUsd),
      detail: "Paid rewards and cleared pending cashback · event-time USD",
    },
    {
      label: "Cashback generated",
      value: usd(account.lifetimeCashbackGeneratedUsd),
      detail: `${usd(account.lifetimeCashbackGeneratedForOthersUsd)} generated for other recipients`,
    },
    {
      label: hasUnpricedPositions ? "Priced balance" : "Latest indexed balance",
      value: lowerBoundUsd(displayedBalanceUsd, hasUnpricedPositions),
      detail: [
        hasUnpricedPositions ? `Excludes ${unpricedDetail}` : null,
        detail.balanceUpdatedAt ? `balance state ${timeAgo(detail.balanceUpdatedAt)}` : "balance state unavailable",
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      label: hasUnpricedPositions ? "Priced net worth" : "Net worth",
      value: lowerBoundUsd(displayedNetWorthUsd, hasUnpricedPositions),
      detail: hasUnpricedPositions
        ? `Priced balance minus event-ledger debt · excludes ${unpricedDetail}`
        : "indexed balance minus event-ledger debt",
    },
  ];

  return (
    <>
      <section className="pt-6 sm:pt-8">
        <Link
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          href="/accounts"
        >
          Accounts / {shortAddress(safe)}
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <SafeTierImage className="size-14" tierId={account.tierId} />
          <div className="min-w-0">
            <h1 className="break-all font-mono text-xl font-normal tracking-[-.03em] text-foreground sm:text-2xl">
              {safe.toLowerCase()}
            </h1>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{safeTierName(account.tierId)} tier</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {detail.chainIds.map((chainId) => {
              const chainName = INDEXED_CHAIN_BY_ID.get(chainId)?.name ?? `Chain ${chainId}`;
              const explorerUrl = explorerAddressUrl(chainId, safe);
              const content = (
                <>
                  <ChainBadge chainId={chainId} className="size-4" />
                  {chainName}
                  {explorerUrl ? <ExternalLink aria-hidden="true" className="size-3" /> : null}
                </>
              );

              return explorerUrl ? (
                <a
                  aria-label={`Open ${safe} on ${chainName}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
                  href={explorerUrl}
                  key={chainId}
                  rel="noreferrer"
                  target="_blank"
                >
                  {content}
                </a>
              ) : (
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
                  key={chainId}
                >
                  {content}
                </span>
              );
            })}
          </div>
        </div>
      </section>
      <section aria-label="Cumulative account metrics" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

export const usd = (value: number | null) => (value == null ? "Unpriced" : money.format(value));
const lowerBoundUsd = (value: number | null, partial: boolean) =>
  value == null ? "Unpriced" : `${partial ? "≥" : ""}${money.format(value)}`;
