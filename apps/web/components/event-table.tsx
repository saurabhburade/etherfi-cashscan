import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { formatUnits, isAddress, zeroAddress } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { TokenIcon } from "@/components/token-icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exactCashExplorerEventLabel } from "@/lib/cash-explorer";
import type { Activity } from "@/lib/envio";
import { compactUsd, shortAddress, timeAgo } from "@/lib/format";

const tokenAmount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
export const eventTableClassName =
  "min-w-[760px] table-fixed text-sm font-medium text-foreground [&_td]:py-3 [&_td]:text-foreground [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th]:py-4 [&_th]:text-foreground [&_th:first-child]:pl-5 [&_th:last-child]:pr-5 sm:[&_td:first-child]:pl-6 sm:[&_td:last-child]:pr-6 sm:[&_th:first-child]:pl-6 sm:[&_th:last-child]:pr-6";

export function EventTableColumnGroup() {
  return (
    <colgroup>
      <col className="w-[34%]" />
      <col className="w-[15%]" />
      <col className="w-[15%]" />
      <col className="w-[19%]" />
      <col className="w-[17%]" />
    </colgroup>
  );
}

/** A compact, explorer-linked ledger for indexed protocol events. */
export function EventTable({ activity }: { activity: Activity[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[.075] bg-[#181818]">
      <Table aria-label="Latest protocol events" className={eventTableClassName}>
        <EventTableColumnGroup />
        <TableHeader>
          <TableRow className="border-white/[.07] bg-transparent hover:bg-transparent">
            <TableHead>Event</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Contract</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Transaction</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activity.length ? (
            activity.map((item) => {
              const chain = INDEXED_CHAIN_BY_ID.get(item.chainId);
              const transactionUrl = chain ? `${chain.explorer}/tx/${item.transactionHash}` : undefined;
              const hasToken = item.token !== zeroAddress;
              const iconSymbol =
                item.tokenSymbol || (hasToken ? shortAddress(item.token) : item.amountUsd ? "USD" : "TX");
              return (
                <TableRow className="border-border hover:bg-muted/50" key={item.id}>
                  <TableCell>
                    <div className="flex min-w-56 items-center gap-3">
                      <span className="relative inline-flex size-10 shrink-0">
                        {!hasToken && iconSymbol === "TX" ? (
                          <span
                            aria-label="Protocol event"
                            className="inline-grid size-10 place-items-center rounded-full border border-border bg-secondary text-muted-foreground dark:bg-zinc-800 dark:text-zinc-400"
                            role="img"
                          >
                            <FileText aria-hidden="true" className="size-4" />
                          </span>
                        ) : (
                          <TokenIcon
                            address={item.token || zeroAddress}
                            chainId={item.chainId}
                            className="size-10 text-[9px]"
                            symbol={iconSymbol}
                          />
                        )}
                        <ChainBadge className="absolute -bottom-0.5 -right-0.5" chainId={item.chainId} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate capitalize text-foreground">
                          {exactCashExplorerEventLabel(item.type)}
                        </span>
                        <time className="mt-1 block truncate text-muted-foreground" dateTime={item.timestamp}>
                          {timeAgo(item.timestamp)}
                        </time>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isAddress(item.actor) ? (
                      <Link
                        className="underline decoration-foreground/40 underline-offset-4 transition hover:opacity-70"
                        href={`/accounts/${item.actor}`}
                      >
                        {shortAddress(item.actor)}
                      </Link>
                    ) : (
                      shortAddress(item.actor)
                    )}
                  </TableCell>
                  <TableCell>{shortAddress(item.contractAddress)}</TableCell>
                  <TableCell>{eventValue(item)}</TableCell>
                  <TableCell>
                    {transactionUrl ? (
                      <a
                        aria-label={`Open transaction ${shortAddress(item.transactionHash)} in ${chain?.name ?? "the block explorer"}`}
                        className="inline-flex items-center gap-1.5 underline decoration-foreground/40 underline-offset-4 transition hover:opacity-70"
                        href={transactionUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {shortAddress(item.transactionHash)}
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    ) : (
                      shortAddress(item.transactionHash)
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell className="h-36 text-center text-sm" colSpan={5}>
                No indexed events match these filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function filterActivity(activity: Activity[], query: string, chainId: number) {
  const needle = query.toLowerCase();
  return activity.filter(
    (item) =>
      (!chainId || item.chainId === chainId) &&
      (!needle ||
        [
          item.type,
          item.actor,
          item.contractAddress,
          item.token,
          item.tokenName,
          item.tokenSymbol,
          item.transactionHash,
        ].some((value) => value.toLowerCase().includes(needle))),
  );
}

function eventValue(item: Activity) {
  if (item.tokenLegs?.length) {
    return (
      <div className="space-y-1">
        {item.tokenLegs.slice(0, 3).map((leg, index) => (
          <div key={`${leg.token}:${index}`}>
            {leg.amount !== "0" && leg.decimals !== null
              ? `${tokenAmount.format(Number(formatUnits(BigInt(leg.amount), leg.decimals)))} `
              : null}
            <TokenDetailLink label={leg.symbol || tokenLabel(leg.token)} token={leg.token} />
            {leg.amountUsd !== null ? (
              <span className="ml-1 text-muted-foreground">· {compactUsd(leg.amountUsd)}</span>
            ) : (
              <UnpricedBadge />
            )}
          </div>
        ))}
        {item.tokenLegs.length > 3 ? (
          <span className="text-muted-foreground">+{item.tokenLegs.length - 3} tokens</span>
        ) : null}
      </div>
    );
  }
  if (item.type.startsWith("spend") && item.token === zeroAddress && item.amountUsd) {
    const scope =
      item.tokenCount > 1 ? `${item.tokenCount} tokens` : item.tokenCount === 1 ? "1 token" : "Settled spend";
    return `${scope} · ${compactUsd(item.amountUsd)}`;
  }
  if (item.amount !== "0" && item.tokenDecimals !== null) {
    try {
      const amount = tokenAmount.format(Number(formatUnits(BigInt(item.amount), item.tokenDecimals)));
      const label = (
        <>
          {amount} <TokenDetailLink label={item.tokenSymbol || tokenLabel(item.token)} token={item.token} />
        </>
      );
      return item.amountUsd ? (
        <span>
          <span className="block">{label}</span>
          <span className="mt-1 block text-muted-foreground">{compactUsd(item.amountUsd)}</span>
        </span>
      ) : (
        label
      );
    } catch {
      /* show the indexed fallback below */
    }
  }
  if (item.amountUsd) return compactUsd(item.amountUsd);
  if (item.amountUsdStatus?.toLowerCase() === "unpriced") return <UnpricedBadge />;
  if (item.amount !== "0") {
    try {
      return `${BigInt(item.amount).toLocaleString("en-US")} raw`;
    } catch {
      return item.amount;
    }
  }
  return <TokenDetailLink label={item.tokenSymbol || tokenLabel(item.token)} token={item.token} />;
}

function TokenDetailLink({ label, token }: { label: string; token: string }) {
  if (!isAddress(token) || token === zeroAddress) return label;
  return (
    <Link
      className="underline decoration-foreground/40 underline-offset-4 transition hover:opacity-70"
      href={`/tokens/${token}`}
    >
      {label}
    </Link>
  );
}

function UnpricedBadge() {
  return (
    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Unpriced
    </span>
  );
}

function tokenLabel(token: string) {
  return token.startsWith("0x") ? shortAddress(token) : token || "—";
}
