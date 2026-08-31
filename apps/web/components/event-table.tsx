import { CHAIN_IDS, INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import { ExternalLink, FileText } from "lucide-react";
import { formatUnits, zeroAddress } from "viem";
import { ChainBadge } from "@/components/chain-badge";
import { TokenIcon } from "@/components/token-icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Activity } from "@/lib/envio";
import { compactUsd, shortAddress } from "@/lib/format";

const tokenAmount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

/** A compact, explorer-linked ledger for indexed protocol events. */
export function EventTable({ activity }: { activity: Activity[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/[.075] bg-[#181818]">
      <Table
        aria-label="Latest protocol events"
        className="min-w-[840px] [&_td]:py-3 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5 sm:[&_td:first-child]:pl-6 sm:[&_td:last-child]:pr-6 sm:[&_th:first-child]:pl-6 sm:[&_th:last-child]:pr-6"
      >
        <TableHeader>
          <TableRow className="border-white/[.07] bg-transparent hover:bg-transparent">
            <TableHead>Event</TableHead>
            <TableHead>Network</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Contract</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Transaction</span>
            </TableHead>
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
                        <span className="block truncate font-semibold capitalize text-foreground">
                          {item.type.replaceAll("_", " ")}
                        </span>
                        <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
                          {eventTokenLabel(item)}
                        </span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-zinc-500">{chain?.name ?? item.chainId}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500">{shortAddress(item.actor)}</TableCell>
                  <TableCell className="font-mono text-xs text-zinc-600">
                    {shortAddress(item.contractAddress)}
                  </TableCell>
                  <TableCell className="font-medium text-zinc-200">{eventValue(item)}</TableCell>
                  <TableCell className="text-xs text-zinc-600">
                    <time dateTime={item.timestamp}>
                      {new Date(item.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </TableCell>
                  <TableCell>
                    {transactionUrl ? (
                      <a
                        aria-label={`Open transaction ${shortAddress(item.transactionHash)} in ${chain?.name ?? "the block explorer"}`}
                        className="text-zinc-600 hover:text-zinc-200"
                        href={transactionUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell className="h-36 text-center text-sm text-zinc-600" colSpan={7}>
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
  return activity.filter((item) => {
    const isNoisyOptimismInterestUpdate =
      item.chainId === CHAIN_IDS.optimism && item.type === "debt_interest_index_updated";
    return (
      !isNoisyOptimismInterestUpdate &&
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
        ].some((value) => value.toLowerCase().includes(needle)))
    );
  });
}

function eventValue(item: Activity) {
  if (item.type.startsWith("spend") && item.token === zeroAddress && item.amountUsd) {
    const scope =
      item.tokenCount > 1 ? `${item.tokenCount} tokens` : item.tokenCount === 1 ? "1 token" : "Settled spend";
    return `${scope} · ${compactUsd(item.amountUsd)}`;
  }
  if (item.amount !== "0" && item.tokenDecimals !== null) {
    try {
      const amount = tokenAmount.format(Number(formatUnits(BigInt(item.amount), item.tokenDecimals)));
      const label = `${amount} ${item.tokenSymbol || tokenLabel(item.token)}`;
      return item.amountUsd ? `${label} · ${compactUsd(item.amountUsd)}` : label;
    } catch {
      /* show the indexed fallback below */
    }
  }
  if (item.amountUsd) return compactUsd(item.amountUsd);
  if (item.amount !== "0") {
    try {
      return `${BigInt(item.amount).toLocaleString("en-US")} raw`;
    } catch {
      return item.amount;
    }
  }
  return item.tokenSymbol || tokenLabel(item.token);
}

function tokenLabel(token: string) {
  return token.startsWith("0x") ? shortAddress(token) : token || "—";
}

function eventTokenLabel(item: Activity) {
  if (item.tokenName && item.tokenSymbol) return `${item.tokenName} (${item.tokenSymbol})`;
  if (item.tokenName) return item.tokenName;
  if (item.tokenSymbol) return item.tokenSymbol;
  return item.token === zeroAddress ? "Protocol event" : shortAddress(item.token);
}
