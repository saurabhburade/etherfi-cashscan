"use client";

import { INDEXED_CHAINS } from "@etherfi/contracts";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { ChainBadge } from "@/components/chain-badge";
import { SafeTierImage } from "@/components/safe-tier-image";
import { Button } from "@/components/ui/button";
import type { AccountAnalyticsPage, AccountAnalyticsSort } from "@/lib/account-analytics";
import { compactUsd, shortAddress } from "@/lib/format";
import { safeTierName } from "@/lib/safe-tier";

const pageSize = 10;

export function AccountExplorer({ initialPage }: { initialPage: AccountAnalyticsPage }) {
  const [query, setQuery] = useState("");
  const [chainId, setChainId] = useState(0);
  const [sort, setSort] = useState<AccountAnalyticsSort>("balance");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const firstRequest = useRef(true);
  const deferredQuery = useDeferredValue(query);
  const firstItem = result.accounts.length ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem ? firstItem + result.accounts.length - 1 : 0;
  const hasFilters = query !== "" || chainId !== 0 || sort !== "balance";

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
    if (deferredQuery.trim()) params.set("query", deferredQuery.trim());
    if (chainId) params.set("chainId", String(chainId));

    setLoading(true);
    setError("");
    fetch(`/api/accounts?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load this account page");
        return (await response.json()) as AccountAnalyticsPage;
      })
      .then(setResult)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError"))
          setError(requestError instanceof Error ? requestError.message : "Unable to load this account page");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [chainId, deferredQuery, page, sort]);

  function resetPage() {
    setPage(1);
  }

  function clearFilters() {
    setQuery("");
    setChainId(0);
    setSort("balance");
    resetPage();
  }

  return (
    <section className="pt-8 sm:pt-10">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search accounts</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-10 w-full rounded-xl border border-border bg-background pr-10 pl-10 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
            onChange={(event) => {
              setQuery(event.target.value);
              resetPage();
            }}
            placeholder="Search Safe address"
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => {
                setQuery("");
                resetPage();
              }}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        <Select
          label="Filter by network"
          onChange={(value) => {
            setChainId(Number(value));
            resetPage();
          }}
          value={String(chainId)}
        >
          <option value="0">All networks</option>
          {INDEXED_CHAINS.map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.name}
            </option>
          ))}
        </Select>
        <Select
          label="Sort accounts"
          onChange={(value) => {
            setSort(value as AccountAnalyticsSort);
            resetPage();
          }}
          value={sort}
          wide
        >
          <option value="balance">Highest balance</option>
          <option value="spend">Highest spend</option>
          <option value="deposits">Highest deposits</option>
          <option value="recent">Recently active</option>
        </Select>
        {hasFilters ? (
          <Button className="h-10 sm:px-4" onClick={clearFilters} variant="ghost">
            Reset
          </Button>
        ) : null}
      </div>

      <article className="mt-6 overflow-hidden rounded-2xl border border-border/40 bg-card text-card-foreground">
        <div className="px-5 py-5 sm:px-6">
          <span className="text-sm font-semibold text-muted-foreground">Accounts</span>
          <h2 className="mt-2 text-xl font-normal tracking-[-.03em]">Safe balances and flows</h2>
        </div>
        {loading ? <AccountTableSkeleton /> : <AccountTable rows={result.accounts} />}
      </article>
      {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
      {page > 1 || result.hasNextPage ? (
        <nav aria-label="Account pagination" className="mt-4 flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-muted-foreground">
            {firstItem}–{lastItem}
          </p>
          <div className="flex items-center gap-2">
            <Button
              aria-label="Previous page"
              disabled={page === 1 || loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              size="icon"
              variant="outline"
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-20 text-center text-sm font-medium text-foreground">Page {page}</span>
            <Button
              aria-label="Next page"
              disabled={!result.hasNextPage || loading}
              onClick={() => setPage((value) => value + 1)}
              size="icon"
              variant="outline"
            >
              <ChevronRight />
            </Button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}

function AccountTable({ rows }: { rows: AccountAnalyticsPage["accounts"] }) {
  if (!rows.length)
    return (
      <div className="border-t border-border/40 px-6 py-16 text-center text-sm text-muted-foreground">
        No indexed accounts match these filters.
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] table-fixed text-left text-sm font-medium text-foreground">
        <thead className="border-t border-border/40 text-foreground">
          <tr>
            <th className="w-[260px] px-6 py-4">Safe</th>
            <th className="px-3 py-4 text-right">Deposits</th>
            <th className="px-3 py-4 text-right">Spend</th>
            <th className="px-3 py-4 text-right">Withdrawals</th>
            <th className="px-3 py-4 text-right">Debt</th>
            <th className="px-4 py-4 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            return (
              <tr className="border-t border-border/40 transition-colors hover:bg-muted/30" key={row.id}>
                <td className="px-6 py-4">
                  <Link
                    className="inline-flex min-w-52 items-center gap-3 rounded-lg outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/accounts/${row.safeAddress}`}
                  >
                    <span className="relative shrink-0">
                      <SafeTierImage className="size-10" tierId={row.tierId} />
                      <ChainBadge chainId={row.chainId} className="absolute -right-0.5 -bottom-0.5" />
                    </span>
                    <span className="block whitespace-nowrap">
                      <span className="block font-mono text-foreground">{shortAddress(row.safeAddress)}</span>
                      <span className="mt-1 block capitalize text-muted-foreground">
                        {safeTierName(row.tierId)} tier
                      </span>
                    </span>
                  </Link>
                </td>
                <Metric value={row.lifetimeDepositedUsd} />
                <Metric value={row.lifetimeSpentUsd} />
                <Metric value={row.lifetimeWithdrawnUsd} />
                <Metric value={row.eventLedgerOutstandingDebtUsd} />
                <Metric value={row.currentBalanceUsd} trailing />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ value, trailing = false }: { value: number | null; trailing?: boolean }) {
  return (
    <td className={`${trailing ? "px-4" : "px-3"} py-4 text-right`}>
      <span className="block whitespace-nowrap text-foreground">{value === null ? "Unpriced" : compactUsd(value)}</span>
    </td>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        className={`h-10 w-full appearance-none rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20 ${wide ? "sm:w-48" : "sm:w-36"}`}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function AccountTableSkeleton() {
  return (
    <div className="border-t border-border/40 p-6">
      <div className="space-y-5">
        {Array.from({ length: pageSize }, (_, index) => (
          <div className="h-12 animate-pulse rounded-xl bg-muted" key={index} />
        ))}
      </div>
    </div>
  );
}
