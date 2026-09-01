"use client";

import { INDEXED_CHAINS } from "@etherfi/contracts";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { TransactionTableSkeleton } from "@/components/dashboard-skeletons";
import { EventTable } from "@/components/event-table";
import { Button } from "@/components/ui/button";
import { exactCashExplorerEventLabel } from "@/lib/cash-explorer";
import type { ActivityPage, ActivityTokenScope } from "@/lib/envio";

const pageSize = 10;

export function TransactionExplorer({
  initialPage,
  availableEventTypes,
  account,
  tokenScopes,
  showHeader = true,
}: {
  initialPage: ActivityPage;
  availableEventTypes?: string[];
  account?: string;
  tokenScopes?: ActivityTokenScope[];
  showHeader?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [chainId, setChainId] = useState(0);
  const [eventType, setEventType] = useState("all");
  const [page, setPage] = useState(1);
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [result, setResult] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const firstRequest = useRef(true);
  const deferredQuery = useDeferredValue(query);
  const tokenScopeParam = tokenScopes?.map((scope) => `${scope.chainId}:${scope.token.toLowerCase()}`).join(",");

  const pageEventTypes = useMemo(
    () =>
      [...new Set(initialPage.activity.map((item) => item.type))].sort((a, b) =>
        labelEvent(a).localeCompare(labelEvent(b)),
      ),
    [initialPage.activity],
  );
  const eventTypes = availableEventTypes?.length ? availableEventTypes : pageEventTypes;
  const currentPage = page;
  const firstItem = result.activity.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastItem = firstItem ? firstItem + result.activity.length - 1 : 0;
  const hasFilters = query !== "" || chainId !== 0 || eventType !== "all";

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (account) params.set("account", account);
    if (tokenScopeParam) {
      params.set("tokenScopes", tokenScopeParam);
    }
    if (cursor) params.set("cursor", cursor);
    if (deferredQuery.trim()) params.set("query", deferredQuery.trim());
    if (chainId) params.set("chainId", String(chainId));
    if (eventType !== "all") params.set("eventType", eventType);

    setLoading(true);
    setError("");
    fetch(`/api/transactions?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load this transaction page");
        return (await response.json()) as ActivityPage;
      })
      .then(setResult)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError(requestError instanceof Error ? requestError.message : "Unable to load this transaction page");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [account, chainId, cursor, deferredQuery, eventType, page, tokenScopeParam]);

  function clearFilters() {
    setQuery("");
    setChainId(0);
    setEventType("all");
    setPage(1);
    setCursor(undefined);
    setCursorHistory([]);
  }

  return (
    <section className={showHeader ? "py-8 sm:py-10" : "pb-8 sm:pb-10"}>
      {showHeader ? <TransactionExplorerHeader /> : null}

      <div
        className={`${showHeader ? "mt-8 " : ""}flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-3 sm:flex-row sm:items-center`}
      >
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search transactions</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className="h-10 w-full rounded-xl border border-border bg-background pr-10 pl-10 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
              setCursor(undefined);
              setCursorHistory([]);
            }}
            placeholder="Search address, token, event or transaction hash"
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => {
                setQuery("");
                setPage(1);
                setCursor(undefined);
                setCursorHistory([]);
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </label>

        <label>
          <span className="sr-only">Filter by network</span>
          <select
            className="h-10 w-full appearance-none rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20 sm:w-36"
            onChange={(event) => {
              setChainId(Number(event.target.value));
              setPage(1);
              setCursor(undefined);
              setCursorHistory([]);
            }}
            value={chainId}
          >
            <option value={0}>All networks</option>
            {INDEXED_CHAINS.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">Filter by event</span>
          <select
            className="h-10 w-full appearance-none rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20 sm:w-48"
            onChange={(event) => {
              setEventType(event.target.value);
              setPage(1);
              setCursor(undefined);
              setCursorHistory([]);
            }}
            value={eventType}
          >
            <option value="all">All event types</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {labelEvent(type)}
              </option>
            ))}
          </select>
        </label>

        {hasFilters ? (
          <Button className="h-10 sm:px-4" onClick={clearFilters} variant="ghost">
            Reset
          </Button>
        ) : null}
      </div>

      <div className="mt-6">
        {loading ? <TransactionTableSkeleton /> : <EventTable activity={result.activity} />}
        {error ? <p className="mt-3 text-sm font-medium text-destructive">{error}</p> : null}
        {currentPage > 1 || result.hasNextPage ? (
          <nav aria-label="Transaction pagination" className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-muted-foreground">
              {firstItem}–{lastItem}
            </p>
            <div className="flex items-center gap-2">
              <Button
                aria-label="Previous page"
                disabled={currentPage === 1 || loading}
                onClick={() => {
                  setCursor(cursorHistory.at(-1));
                  setCursorHistory((history) => history.slice(0, -1));
                  setPage(currentPage - 1);
                }}
                size="icon"
                variant="outline"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="min-w-20 text-center text-sm font-medium text-foreground">Page {currentPage}</span>
              <Button
                aria-label="Next page"
                disabled={!result.hasNextPage || loading}
                onClick={() => {
                  setCursorHistory((history) => [...history, cursor]);
                  setCursor(result.nextCursor);
                  setPage(currentPage + 1);
                }}
                size="icon"
                variant="outline"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
        ) : null}
      </div>
    </section>
  );
}

export function TransactionExplorerHeader() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-normal tracking-[-.03em] text-foreground">Transactions</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Browse the latest indexed Cash activity across current and legacy destination networks.
      </p>
    </div>
  );
}

function labelEvent(type: string) {
  return exactCashExplorerEventLabel(type);
}
