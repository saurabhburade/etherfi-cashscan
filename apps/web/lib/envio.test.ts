import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_EVENT_TYPES_QUERY,
  ACTIVITY_PAGE_QUERY,
  activityRow,
  cashHistoryForDisplay,
  deriveCashSafeData,
  EVENTS_QUERY,
  eventWhere,
  explorerDataOperations,
  loadExplorerData,
  TIER_COUNT_METRICS_QUERY,
  TOKEN_ACTIVITY_EVENT_TYPES_QUERY,
  TOKEN_ANALYTICS_QUERY,
  type TokenRecord,
  tierDistributionFromMetricRows,
  tokenAnalyticsRows,
} from "./envio";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("activity token normalization", () => {
  it("promotes a single withdrawal token and amount from protocol metadata", () => {
    const tokenAddress = "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58";
    const token = {
      chainId: 10,
      address: tokenAddress,
      name: "Tether USD",
      symbol: "USDT",
      decimals: 6,
      decimalsVerified: true,
      oracleDecimals: 8,
      oracleHeartbeat: 0,
      price: "0",
      priceUpdatedAt: "0",
      hasSpend: false,
      hasTopUp: false,
      hasRepayment: false,
      hasDebt: false,
      hasBalance: false,
      latestSpendPriceUsdE18: "0",
      latestSpendPriceStatus: "",
      analyticsUpdatedAt: "",
    } satisfies TokenRecord;

    const activity = activityRow(
      {
        id: "withdrawal",
        eventType: "withdrawal_processed",
        chainId: 10,
        blockNumber: "1",
        contractAddress: "0x0000000000000000000000000000000000000001",
        actor: "0x0000000000000000000000000000000000000002",
        tokenAddress: "0x0000000000000000000000000000000000000000",
        amount: "0",
        amountUsd: "0",
        timestamp: "2026-09-01T00:00:00Z",
        transactionHash: "0xhash",
        metadata: JSON.stringify({ tokens: [tokenAddress], amounts: ["187392"] }),
      },
      new Map([[`10:${tokenAddress}`, token]]),
      new Map(),
    );

    expect(activity).toEqual(
      expect.objectContaining({
        token: tokenAddress,
        amount: "187392",
        tokenName: "Tether USD",
        tokenSymbol: "USDT",
        tokenDecimals: 6,
        tokenCount: 1,
      }),
    );
  });
});

describe("event query contract", () => {
  it("loads event types from materialized metrics independently of paginated activity", () => {
    expect(ACTIVITY_EVENT_TYPES_QUERY).toContain("ScannerEventTypeMetric(");
    expect(TOKEN_ACTIVITY_EVENT_TYPES_QUERY).toContain("ScannerTokenEventTypeMetric(");
    expect(ACTIVITY_EVENT_TYPES_QUERY).not.toContain("distinct_on");
    expect(TOKEN_ACTIVITY_EVENT_TYPES_QUERY).not.toContain("distinct_on");
    expect(ACTIVITY_EVENT_TYPES_QUERY).toContain("order_by: [{ eventType: asc }]");
    expect(TOKEN_ACTIVITY_EVENT_TYPES_QUERY).toContain("where: $where");
    expect(ACTIVITY_EVENT_TYPES_QUERY).not.toContain("limit:");
  });

  it("omits unrelated explorer operations for every route profile", () => {
    expect(explorerDataOperations("home")).toEqual(["core", "globalActiveSafes", "events", "tokens"]);
    expect(explorerDataOperations("stats")).toEqual([
      "globalActiveSafes",
      "spendBuckets",
      "hourly",
      "tokens",
      "extendedDaily",
      "cashbackTotal",
      "rampTokenMetrics",
      "fxRates",
      "tierCountMetrics",
      "tierHistory",
    ]);
    expect(explorerDataOperations("transactions")).toEqual(["core", "spendBuckets"]);
    expect(explorerDataOperations("accounts")).toEqual(["core", "globalActiveSafes", "tierCountMetrics"]);
    expect(explorerDataOperations("tokens")).toEqual(["status"]);
    expect(explorerDataOperations("status")).toEqual(["status"]);
    expect(explorerDataOperations("stats")).not.toEqual(
      expect.arrayContaining([
        "topUpRecipients",
        "cashbackReceivers",
        "debtMetrics",
        "cashOperations",
        "cashConfiguration",
      ]),
    );
  });

  it("keeps the default profile free of alternative duplicate operations", () => {
    const full = explorerDataOperations();
    expect(full).not.toContain("status");
    expect(full).toEqual(expect.arrayContaining(["cashSafeState", "tierCountMetrics"]));
    expect(full).not.toEqual(expect.arrayContaining(["cashHistory", "tierHistory"]));
    expect(new Set(full).size).toBe(full.length);
  });

  it("uses compact, chain-filterable tier count metrics instead of SafeTierState scans", () => {
    expect(TIER_COUNT_METRICS_QUERY).toContain("SafeTierCountMetric_bool_exp!");
    expect(TIER_COUNT_METRICS_QUERY).toContain("SafeTierCountMetric(limit: 100, where: $where");
    expect(TIER_COUNT_METRICS_QUERY).toContain("id chainId tierId safeCount updatedAt updatedBlock");
    expect(TIER_COUNT_METRICS_QUERY).not.toContain("SafeTierState");
    expect(TIER_COUNT_METRICS_QUERY).not.toContain("_aggregate");
  });

  it("sends the requested chain predicate to tier count metrics", async () => {
    const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
        requests.push(request);
        const data = request.query.includes("SafeTierCountMetric")
          ? { SafeTierCountMetric: [{ chainId: 10, tierId: 1, safeCount: "3" }] }
          : { ActiveSafe_aggregate: { aggregate: { count: 3 } }, DailyCashMetric: [] };
        return new Response(JSON.stringify({ data }), { status: 200 });
      }),
    );

    const data = await loadExplorerData({ chainId: 10 }, "accounts");

    expect(requests.find((request) => request.query.includes("SafeTierCountMetric"))?.variables).toEqual({
      where: { chainId: { _eq: 10 } },
    });
    expect(data.tierDistribution).toEqual([{ tierId: 1, safeCount: 3 }]);
  });

  it("uses lookahead limit and offset pagination without an aggregate count", () => {
    expect(ACTIVITY_PAGE_QUERY).not.toContain("ProtocolEvent_aggregate");
    expect(ACTIVITY_PAGE_QUERY).toContain("limit: $limit");
    expect(ACTIVITY_PAGE_QUERY).toContain("offset: $offset");
  });

  it("uses the complete deterministic feed order", () => {
    expect(EVENTS_QUERY).toContain(
      "order_by: [{ timestamp: desc }, { chainId: asc }, { blockNumber: desc }, { logIndex: desc }, { id: asc }]",
    );
  });

  it("loads homepage spends and cashbacks independently", () => {
    expect(EVENTS_QUERY).toContain("latestSpends: ProtocolEvent(");
    expect(EVENTS_QUERY).toContain("latestCashbacks: ProtocolEvent(");
    expect(EVENTS_QUERY.match(/limit: 10/g)).toHaveLength(2);
    expect(EVENTS_QUERY).toContain("where: $spendWhere");
    expect(EVENTS_QUERY).toContain("where: $cashbackWhere");
  });

  it("uses indexable exact predicates for supported search keys", () => {
    const hash = `0x${"AB".repeat(32)}`;
    const address = `0x${"CD".repeat(20)}`;

    expect(eventWhere({ query: hash, chainId: 10 })).toEqual({
      chainId: { _eq: 10 },
      transactionHash: { _eq: hash.toLowerCase() },
    });
    expect(eventWhere({ query: address })).toEqual({
      _or: ["actor", "contractAddress", "tokenAddress"].map((field) => ({
        [field]: { _eq: address.toLowerCase() },
      })),
    });
    expect(eventWhere({ query: "123456" })).toEqual({ blockNumber: { _eq: "123456" } });
    expect(eventWhere({ query: "Spend_Settled" })).toEqual({ eventType: { _eq: "spend_settled" } });
  });

  it("turns unsupported fuzzy input into an indexed empty lookup", () => {
    expect(eventWhere({ query: "merchant coffee" })).toEqual({ id: { _eq: "" } });
  });
});

describe("cash history completeness", () => {
  it("withholds bounded history when either result set is incomplete", () => {
    const history = cashHistoryForDisplay({
      SafeTierChange_aggregate: { aggregate: { count: 5001 } },
      SafeTierChange: [{ timestamp: "2026-08-02" }],
      SafeModeChange_aggregate: { aggregate: { count: 1 } },
      SafeModeChange: [{ timestamp: "2026-08-02" }],
    });

    expect(history).toEqual({ complete: false, tierChanges: [], modeChanges: [] });
  });
});

describe("token analytics metric contract", () => {
  it("queries compact metric rows with a chain-filterable where variable", () => {
    expect(TOKEN_ANALYTICS_QUERY).toContain("TokenAnalyticsMetric_bool_exp!");
    expect(TOKEN_ANALYTICS_QUERY).toContain("TokenAnalyticsMetric(limit: 1000, where: $metricWhere)");
    expect(TOKEN_ANALYTICS_QUERY).toContain("TokenPriceCurrent(limit: 1000, where: $priceWhere)");
    expect(TOKEN_ANALYTICS_QUERY).toContain("latestSpendPriceUsdE18");
    for (const historicalAggregate of [
      "SpendTokenValuation_aggregate",
      "TopUp_aggregate",
      "WithdrawalEvent_aggregate",
      "SafeTokenBalance_aggregate",
      "AccountTokenBalance_aggregate",
      "DebtEvent_aggregate",
      "Repayment_aggregate",
    ]) {
      expect(TOKEN_ANALYTICS_QUERY).not.toContain(historicalAggregate);
    }
  });

  it("joins metrics by chain and token, maps balances, and preserves USD fallbacks", () => {
    const address = "0x0000000000000000000000000000000000000001";
    const tokens = [
      {
        chainId: 10,
        address,
        name: "USDC",
        symbol: "USDC",
        decimals: 6,
        decimalsVerified: true,
        oracleDecimals: 8,
        oracleHeartbeat: 0,
        price: "0",
        priceUpdatedAt: "0",
        latestSpendPriceUsdE18: "2000000000000000000",
        latestSpendPriceStatus: "priced",
      },
    ] as TokenRecord[];
    const rows = tokenAnalyticsRows(tokens, [
      {
        chainId: 10,
        tokenAddress: address.toUpperCase(),
        spendCount: "2",
        spendUsd: "1000000",
        topUpCount: "1",
        topUpAmount: "3000000",
        withdrawalCount: "1",
        safeAccountCount: "4",
        safeBalance: "9000000",
        safeInflow: "5",
        safeOutflow: "6",
        destinationCount: "7",
        destinationBalance: "4000000",
        destinationInflow: "8",
        destinationOutflow: "9",
        suppliedCount: "10",
        suppliedAmount: "11",
        borrowedCount: "12",
        borrowedAmount: "13",
        borrowedUsd: "14000000",
        borrowedUsdLatest: "26000000",
        borrowedUsdLatestStatus: "latest_indexed_price",
        borrowedUsdLatestPriceUsdE18: "2000000000000000000",
        borrowedUsdLatestPriceAt: "2026-09-01T00:00:00Z",
        borrowedUsdLatestPriceChainId: 10,
        borrowedUsdLatestPriceSource: "spend_implied",
        repaidCount: "15",
        repaidAmount: "16",
        repaidUsd: "17000000",
        latestSpendPriceUsdE18: "2000000000000000000",
      },
      { chainId: "not-a-chain", tokenAddress: address, spendCount: "999" },
      { chainId: 10, tokenAddress: "not-an-address", spendCount: "999" },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        chainId: 10,
        token: address,
        spendUsd: 1,
        topUpUsd: 6,
        reserveBalance: "9000000",
        reserveUsd: 18,
        destinationCredits: "8",
        destinationDebits: "9",
        borrowedUsd: 26,
        borrowedUsdEventTime: 14,
        borrowedUsdStatus: "latest_indexed_price",
        borrowedUsdPriceUsdE18: "2000000000000000000",
        borrowedUsdPriceChainId: 10,
        borrowedUsdPriceSource: "spend_implied",
        repaidUsd: 17,
      }),
    ]);
  });

  it("uses Envio's persisted latest-price borrow valuation when event-time USD is absent", () => {
    const address = "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4";
    const rows = tokenAnalyticsRows(
      [
        {
          chainId: 534352,
          address,
          name: "USD Coin",
          symbol: "USDC",
          decimals: 6,
          decimalsVerified: true,
          oracleDecimals: 0,
          oracleHeartbeat: 0,
          price: "0",
          priceUpdatedAt: "0",
        },
      ] as TokenRecord[],
      [
        {
          chainId: 534352,
          tokenAddress: address,
          borrowedCount: "640903",
          borrowedAmount: "52981545913494",
          borrowedUsd: "0",
          borrowedUsdLatest: "52981545913494",
          borrowedUsdLatestStatus: "latest_indexed_price",
          borrowedUsdLatestPriceUsdE18: "1000000000000000000",
          borrowedUsdLatestPriceAt: "2026-04-09T04:34:51Z",
          borrowedUsdLatestPriceChainId: 534352,
          borrowedUsdLatestPriceSource: "spend_implied",
        },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        borrowedUsd: 52_981_545.913494,
        borrowedUsdEventTime: 0,
        borrowedUsdStatus: "latest_indexed_price",
        borrowedUsdPriceSource: "spend_implied",
      }),
    );
  });

  it("derives latest-price borrow valuation against the legacy Envio schema", () => {
    const address = "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4";
    const rows = tokenAnalyticsRows(
      [
        {
          chainId: 534352,
          address,
          name: "USD Coin",
          symbol: "USDC",
          decimals: 6,
          decimalsVerified: true,
          oracleDecimals: 0,
          oracleHeartbeat: 0,
          price: "0",
          priceUpdatedAt: "0",
        },
      ] as TokenRecord[],
      [
        {
          chainId: 534352,
          tokenAddress: address,
          borrowedCount: "640903",
          borrowedAmount: "52981545913494",
          borrowedUsd: "0",
          latestSpendPriceUsdE18: "1000000000000000000",
          latestSpendPriceStatus: "spend_implied",
          latestSpendAt: "2026-04-09T04:34:51Z",
        },
      ],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        borrowedUsd: 52_981_545.913494,
        borrowedUsdEventTime: 0,
        borrowedUsdStatus: "latest_indexed_price",
        borrowedUsdPriceUsdE18: "1000000000000000000",
        borrowedUsdPriceChainId: 534352,
        borrowedUsdPriceSource: "spend_implied",
      }),
    );
  });

  it("prefers a fresh indexed oracle price over a spend-implied price", () => {
    const address = "0x0000000000000000000000000000000000000001";
    const rows = tokenAnalyticsRows(
      [
        {
          chainId: 10,
          address,
          name: "Wrapped eETH",
          symbol: "weETH",
          decimals: 18,
          decimalsVerified: true,
          oracleDecimals: 8,
          oracleHeartbeat: 3600,
          price: "350000000000",
          priceUpdatedAt: String(Math.floor(Date.now() / 1000)),
        },
      ] as TokenRecord[],
      [
        {
          chainId: 10,
          tokenAddress: address,
          topUpCount: "1",
          topUpAmount: "2000000000000000000",
          safeBalance: "4000000000000000000",
          destinationBalance: "3000000000000000000",
          latestSpendPriceUsdE18: "2000000000000000000000",
        },
      ],
    );

    expect(rows[0]).toEqual(expect.objectContaining({ topUpUsd: 7000, reserveUsd: 14_000 }));
  });

  it("uses canonical TokenPriceCurrent for transfer-only Safe balances", () => {
    const address = "0x01f0a31698c4d065659b9bdc21b3610292a1c506";
    const rows = tokenAnalyticsRows(
      [
        {
          chainId: 534352,
          address,
          name: "Wrapped eETH",
          symbol: "weETH",
          decimals: 18,
          decimalsVerified: true,
          oracleDecimals: 0,
          oracleHeartbeat: 0,
          price: "0",
          priceUpdatedAt: "0",
        },
      ] as TokenRecord[],
      [{ chainId: 534352, tokenAddress: address, safeAccountCount: "1", safeBalance: "47751182233108977" }],
      [
        {
          chainId: 534352,
          tokenAddress: address,
          priceUsdE18: "2342321528000000000000",
          priceStatus: "oracle_priced",
        },
      ],
    );

    expect(rows[0]?.reserveUsd).toBeCloseTo(111.848622, 6);
  });

  it("uses the verified modern weETH price for the legacy Scroll contract", () => {
    const legacyAddress = "0xca0bfd5f735924e34cc567146989e467ffbbce1a";
    const modernAddress = "0x01f0a31698c4d065659b9bdc21b3610292a1c506";
    const rows = tokenAnalyticsRows(
      [
        {
          chainId: 534352,
          address: legacyAddress,
          name: "Wrapped eETH",
          symbol: "weETH",
          decimals: 18,
          decimalsVerified: true,
          oracleDecimals: 0,
          oracleHeartbeat: 0,
          price: "0",
          priceUpdatedAt: "0",
        },
      ] as TokenRecord[],
      [{ chainId: 534352, tokenAddress: legacyAddress, safeAccountCount: "2", safeInflow: "2484991027313909862" }],
      [
        {
          chainId: 534352,
          tokenAddress: legacyAddress,
          priceUsdE18: null,
          priceStatus: "unavailable",
        },
        {
          chainId: 534352,
          tokenAddress: modernAddress,
          priceUsdE18: "2849444799360000000000",
          priceStatus: "historical_constant_priced",
        },
      ],
    );

    expect(rows[0]?.reserveUsd).toBe(0);
    expect(rows[0]?.topUpUsd).toBe(0);
    expect(rows[0]?.safeInflow).toBe("2484991027313909862");
  });
});

describe("deriveCashSafeData", () => {
  it("aggregates compact tier metrics globally or for one chain", () => {
    const metrics = [
      { chainId: 10, tierId: 0, safeCount: "2" },
      { chainId: 10, tierId: 1, safeCount: "3" },
      { chainId: 8453, tierId: 0, safeCount: "5" },
      { chainId: 8453, tierId: 1, safeCount: "7" },
    ];

    expect(tierDistributionFromMetricRows(metrics)).toEqual([
      { tierId: 0, safeCount: 7 },
      { tierId: 1, safeCount: 10 },
    ]);
    expect(tierDistributionFromMetricRows(metrics, 10)).toEqual([
      { tierId: 0, safeCount: 2 },
      { tierId: 1, safeCount: 3 },
    ]);
  });

  it("keeps tier distribution empty when the optional metric entity is unavailable", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { query: string };
        if (request.query.includes("SafeTierCountMetric")) {
          return new Response(JSON.stringify({ errors: [{ message: "field does not exist" }] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ data: { ActiveSafe_aggregate: { aggregate: { count: 1 } }, DailyCashMetric: [] } }),
          { status: 200 },
        );
      }),
    );

    return expect(loadExplorerData({ chainId: 10 }, "accounts")).resolves.toMatchObject({ tierDistribution: [] });
  });

  it("groups bounded tier and mode history rows", () => {
    const data = deriveCashSafeData({
      tierStates: [{ tierId: 2 }, { tierId: 2 }, { tierId: 1 }],
      tierChanges: [
        { timestamp: "2026-08-02T00:00:00Z", previousTierId: 1, tierId: 2 },
        { timestamp: "2026-08-02T00:01:00Z", previousTierId: 1, tierId: 2 },
      ],
      modeStates: [{ currentModeId: 3 }, { currentModeId: 3 }],
      modeChanges: [
        { timestamp: "2026-08-02T00:00:00Z", previousModeId: 1, modeId: 3 },
        { timestamp: "2026-08-02T00:01:00Z", previousModeId: 1, modeId: 3 },
      ],
    });

    expect(data.tierDistribution).toEqual([
      { tierId: 1, safeCount: 1 },
      { tierId: 2, safeCount: 2 },
    ]);
    expect(data.tierTransitions).toEqual([
      { day: "2026-08-02", fromTierId: 1, toTierId: 2, count: 2, transitionKind: "upgrade" },
    ]);
    expect(data.modeDistribution).toEqual([{ modeId: 3, safeCount: 2 }]);
    expect(data.modeChanges).toEqual([{ day: "2026-08-02", previousModeId: 1, newModeId: 3, count: 2 }]);
  });

  it("uses exact aggregate tier counts instead of the bounded Safe-state rows", () => {
    const data = deriveCashSafeData({
      tierStates: [{ tierId: 1 }, { tierId: 1 }],
      tierDistribution: [
        { tierId: 0, safeCount: 5262 },
        { tierId: 1, safeCount: 54346 },
        { tierId: 2, safeCount: 1858 },
        { tierId: 3, safeCount: 274 },
        { tierId: 4, safeCount: 8150 },
      ],
    });

    expect(data.tierDistribution).toEqual([
      { tierId: 0, safeCount: 5262 },
      { tierId: 1, safeCount: 54346 },
      { tierId: 2, safeCount: 1858 },
      { tierId: 3, safeCount: 274 },
      { tierId: 4, safeCount: 8150 },
    ]);
  });

  it("uses Cash's six decimal USD convention and keeps only current configuration", () => {
    const data = deriveCashSafeData({
      pendingCashbackBalances: [{ amountUsd: "1234567" }],
      collateralResupplyCount: 6,
      lendSupplyFailureCount: 7,
      tierCashbackPercentages: [{ chainId: 10, tierId: 1, percentage: "2", updatedAt: "2026-02-01" }],
    });

    expect(data.pendingActions.cashbackUsd).toBe(1.234567);
    expect(data.collateralResupplyCount).toBe(6);
    expect(data.lendSupplyFailureCount).toBe(7);
    expect(data.cashConfiguration).toEqual([
      { chainId: 10, key: "tierCashbackPercentage", subkey: "1", value: "2", updatedAt: "2026-02-01" },
    ]);
  });

  it("applies matured mode changes and normalizes emitted lend statuses", () => {
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    const past = String(Math.floor(Date.now() / 1000) - 3600);
    const data = deriveCashSafeData({
      modeStates: [
        { chainId: 10, safe: "0x1", currentModeId: 0, pendingModeId: 1, activationTime: past },
        { chainId: 10, safe: "0x2", currentModeId: 1, pendingModeId: 0, activationTime: future },
      ],
      lendStates: [
        { chainId: 10, safe: "0x1", status: "opted_in", finalizeTime: "0" },
        { chainId: 10, safe: "0x2", status: "opt_out_requested", finalizeTime: future },
        { chainId: 10, safe: "0x3", status: "opt_out_requested", finalizeTime: past },
        { chainId: 10, safe: "0x4", status: "opt_out_executed", finalizeTime: "0" },
      ],
    });

    expect(data.modeDistribution).toEqual([{ modeId: 1, safeCount: 2 }]);
    expect(data.pendingActions.modeChanges).toBe(1);
    expect(data.lendSummary).toEqual({ active: 1, pendingOptOut: 1, optedOut: 2 });
    expect(data.safeCashStates.find((row) => row.safe === "0x1")).toMatchObject({
      currentModeId: 1,
      pendingModeId: null,
      lendStatus: "active",
    });
    expect(data.safeCashStates.find((row) => row.safe === "0x2")).toMatchObject({
      currentModeId: 1,
      pendingModeId: 0,
      lendStatus: "pending_opt_out",
    });
  });

  it("classifies Business as a segment change instead of an upgrade", () => {
    const data = deriveCashSafeData({
      tierChanges: [{ timestamp: "2026-08-02T00:00:00Z", previousTierId: 3, tierId: 4 }],
    });
    expect(data.tierTransitions[0]?.transitionKind).toBe("segment_change");
  });

  it("falls back to safe empty defaults", () => {
    expect(deriveCashSafeData({})).toMatchObject({
      tierDistribution: [],
      tierTransitions: [],
      modeDistribution: [],
      modeChanges: [],
      safeCashStates: [],
      cashConfiguration: [],
      lendSummary: { active: 0, pendingOptOut: 0, optedOut: 0 },
      pendingActions: { withdrawals: 0, cashbackUsd: 0, modeChanges: 0, spendingLimitChanges: 0, lendOptOuts: 0 },
      creditSpendUsd: 0,
      debitSpendUsd: 0,
      collateralResupplyCount: 0,
      lendSupplyFailureCount: 0,
    });
  });
});
