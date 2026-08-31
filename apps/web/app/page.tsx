import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import { FileText } from "lucide-react";
import { formatUnits, zeroAddress } from "viem";

import { SpendOverviewCharts } from "@/components/analytics-charts";
import { ChainBadge } from "@/components/chain-badge";
import { DashboardShell } from "@/components/dashboard-shell";
import { TokenIcon } from "@/components/token-icon";
import { type Activity, loadExplorerData } from "@/lib/envio";
import { compactUsd, shortAddress } from "@/lib/format";

export const runtime = "edge";

const tokenAmount = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const relativeTime = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

function activityValue(activity: Activity) {
  const normalizedType = activity.type.toLowerCase();
  const leadsWithUsd = normalizedType.startsWith("spend") || normalizedType.includes("cashback");
  const usdValue = leadsWithUsd ? compactUsd(activity.amountUsd) : null;

  if (activity.amount !== "0" && activity.tokenDecimals !== null) {
    try {
      const amount = Number(formatUnits(BigInt(activity.amount), activity.tokenDecimals));
      const symbol = activity.tokenSymbol || shortAddress(activity.token);
      const tokenValue = `${tokenAmount.format(amount)} ${symbol}`;
      return usdValue ? `${usdValue} · ${tokenValue}` : tokenValue;
    } catch {
      // Use the indexed USD value when the raw token amount cannot be decoded.
    }
  }

  if (activity.amountUsd || usdValue) {
    return usdValue ?? compactUsd(activity.amountUsd);
  }

  if (activity.token !== zeroAddress) {
    if (
      activity.tokenName &&
      activity.tokenSymbol &&
      activity.tokenName.toLowerCase() !== activity.tokenSymbol.toLowerCase()
    ) {
      return `${activity.tokenName} (${activity.tokenSymbol})`;
    }
    return activity.tokenName || activity.tokenSymbol || shortAddress(activity.token);
  }

  return "—";
}

function activityLabel(type: string) {
  return type.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function timeAgo(timestamp: string) {
  const elapsed = new Date(timestamp).getTime() - Date.now();
  const absoluteElapsed = Math.abs(elapsed);
  const units = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1_000],
  ] as const;
  const [unit, duration] = units.find(([, unitDuration]) => absoluteElapsed >= unitDuration) ?? units.at(-1)!;

  return relativeTime.format(Math.round(elapsed / duration), unit);
}

function activityHref(activity: Activity) {
  const chain = INDEXED_CHAIN_BY_ID.get(activity.chainId);

  return chain?.explorer && activity.transactionHash ? `${chain.explorer}/tx/${activity.transactionHash}` : undefined;
}

function ActivityRow({ activity }: { activity: Activity }) {
  const href = activityHref(activity);
  const hasToken = activity.token !== zeroAddress;
  const iconSymbol =
    activity.tokenSymbol || (hasToken ? shortAddress(activity.token) : activity.amountUsd ? "USD" : "TX");

  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 bg-card px-4 py-4 transition-colors hover:bg-muted/50 sm:px-5">
      <span className="relative inline-flex size-11">
        {!hasToken && iconSymbol === "TX" ? (
          <span
            aria-label="Protocol event"
            className="inline-grid size-11 place-items-center rounded-full border border-border bg-secondary text-muted-foreground dark:bg-zinc-800 dark:text-zinc-400"
            role="img"
          >
            <FileText aria-hidden="true" className="size-5" />
          </span>
        ) : (
          <TokenIcon
            address={activity.token || zeroAddress}
            chainId={activity.chainId}
            className="size-11 text-[10px]"
            symbol={iconSymbol}
          />
        )}
        <ChainBadge className="absolute -bottom-0.5 -right-0.5" chainId={activity.chainId} />
      </span>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold text-zinc-100">{activityLabel(activity.type)}</span>
        <span className="mt-1 block truncate text-xs font-medium text-zinc-400">{activityValue(activity)}</span>
      </div>

      <div className="min-w-0 text-right">
        {href ? (
          <a
            className="block max-w-28 truncate font-mono text-xs text-zinc-500 underline decoration-zinc-700 underline-offset-4 transition hover:text-zinc-100 sm:max-w-none"
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`View transaction ${activity.transactionHash} in the block explorer`}
          >
            {shortAddress(activity.transactionHash)}
          </a>
        ) : (
          <span className="block max-w-28 truncate font-mono text-xs text-zinc-600">
            {shortAddress(activity.transactionHash)}
          </span>
        )}
        <time className="mt-1 block text-xs text-zinc-500" dateTime={activity.timestamp}>
          {timeAgo(activity.timestamp)}
        </time>
      </div>
    </div>
  );
}

function ActivityPanel({ title, activities }: { title: string; activities: Activity[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/40 bg-card text-card-foreground">
      <header className="border-b border-border/35 px-4 py-5 sm:px-5">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      </header>

      {activities.length ? (
        <div className="divide-y divide-border/35">
          {activities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      ) : (
        <div className="grid min-h-48 place-items-center px-5 py-10 text-sm text-muted-foreground">
          No matching activity yet.
        </div>
      )}
    </section>
  );
}

export default async function HomePage() {
  const data = await loadExplorerData();
  const spends = data.activity.filter((activity) => activity.type.toLowerCase().startsWith("spend")).slice(0, 10);
  const cashbacks = data.activity.filter((activity) => activity.type.toLowerCase().includes("cashback")).slice(0, 10);

  return (
    <DashboardShell active="overview" data={data}>
      <main className="pb-20">
        <SpendOverviewCharts data={data} sections={["spend", "cards"]} />

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <ActivityPanel title="Latest Spends" activities={spends} />
          <ActivityPanel title="Latest Cashbacks" activities={cashbacks} />
        </div>
      </main>
    </DashboardShell>
  );
}
