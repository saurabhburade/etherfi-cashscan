import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import { ArrowRight, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { formatUnits, zeroAddress } from "viem";

import { SpendOverviewCharts } from "@/components/analytics-charts";
import { ChainBadge } from "@/components/chain-badge";
import { DashboardShell } from "@/components/dashboard-shell";
import { ActivityGridSkeleton, ChartGridSkeleton } from "@/components/dashboard-skeletons";
import { TokenIcon } from "@/components/token-icon";
import { type Activity, type ExplorerData, loadExplorerData } from "@/lib/envio";
import { compactUsd, shortAddress, timeAgo } from "@/lib/format";

const tokenAmount = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function activityValue(activity: Activity) {
  const normalizedType = activity.type.toLowerCase();
  const leadsWithUsd = normalizedType.startsWith("spend") || normalizedType.includes("cashback");
  const usdValue = leadsWithUsd && activity.amountUsd !== null ? compactUsd(activity.amountUsd) : null;

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

  if (activity.amountUsd !== null || usdValue) {
    return usdValue ?? (activity.amountUsd !== null ? compactUsd(activity.amountUsd) : "—");
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

function activityHref(activity: Activity) {
  const chain = INDEXED_CHAIN_BY_ID.get(activity.chainId);

  return chain?.explorer && activity.transactionHash ? `${chain.explorer}/tx/${activity.transactionHash}` : undefined;
}

function ActivityRow({ activity }: { activity: Activity }) {
  const href = activityHref(activity);
  const hasToken = activity.token !== zeroAddress;
  const hasValue = activity.amount !== "0" || activity.amountUsd !== null;
  const iconSymbol =
    activity.tokenSymbol || (hasToken ? shortAddress(activity.token) : activity.amountUsd ? "USD" : "TX");

  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 bg-card px-4 py-4 text-sm font-medium transition-colors hover:bg-muted/50 sm:px-5">
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
        <span className="block truncate text-zinc-100">{activityLabel(activity.type)}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1 text-zinc-400">
          <time className="shrink-0" dateTime={activity.timestamp}>
            {timeAgo(activity.timestamp)}
          </time>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">by</span>
          <Link
            className="truncate font-mono underline decoration-zinc-600 underline-offset-4 transition hover:text-zinc-100"
            href={`/accounts/${activity.actor}`}
          >
            {shortAddress(activity.actor)}
          </Link>
        </span>
      </div>

      <div className="min-w-0 text-right">
        {hasValue ? <span className="block max-w-48 truncate text-zinc-300">{activityValue(activity)}</span> : null}
        {href ? (
          <a
            className={`${hasValue ? "mt-1" : ""} block max-w-28 truncate font-mono text-zinc-500 underline decoration-zinc-700 underline-offset-4 transition hover:text-zinc-100 sm:max-w-none`}
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`View transaction ${activity.transactionHash} in the block explorer`}
          >
            {shortAddress(activity.transactionHash)}
          </a>
        ) : (
          <span className={`${hasValue ? "mt-1" : ""} block max-w-28 truncate font-mono text-zinc-600`}>
            {shortAddress(activity.transactionHash)}
          </span>
        )}
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
      <Link
        className="flex items-center justify-center gap-2 border-t border-border/35 bg-secondary/35 px-4 py-4 text-sm font-medium text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground sm:px-5"
        href="/transactions"
      >
        View more
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}

export default function HomePage() {
  const dataPromise = loadExplorerData({}, "home");

  return (
    <DashboardShell active="overview" dataPromise={dataPromise}>
      <main className="pb-20">
        <Suspense fallback={<ChartGridSkeleton cards={2} flushBottom topLevel />}>
          <OverviewCharts dataPromise={dataPromise} />
        </Suspense>
        <Suspense fallback={<ActivityGridSkeleton />}>
          <OverviewActivity dataPromise={dataPromise} />
        </Suspense>
      </main>
    </DashboardShell>
  );
}

async function OverviewCharts({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  return <SpendOverviewCharts data={await dataPromise} flushBottom sections={["spend", "cards"]} />;
}

async function OverviewActivity({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  const data = await dataPromise;
  const spends = data.activity.filter((activity) => activity.type.toLowerCase().startsWith("spend")).slice(0, 10);
  const cashbacks = data.activity.filter((activity) => activity.type.toLowerCase().includes("cashback")).slice(0, 10);

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <ActivityPanel title="Latest Spends" activities={spends} />
      <ActivityPanel title="Latest Cashbacks" activities={cashbacks} />
    </div>
  );
}
