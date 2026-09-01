import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PAGE_QUERY,
  activityRow,
  cashHistoryForDisplay,
  deriveCashSafeData,
  EVENTS_QUERY,
  eventWhere,
  TOKEN_ANALYTICS_QUERY,
  type TokenRecord,
  tokenAnalyticsRows,
} from "./envio";

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

  it("uses indexable exact predicates for supported search keys", () => {
    const hash = "0x" + "AB".repeat(32);
    const address = "0x" + "CD".repeat(20);

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
        reserveBalance: "4000000",
        reserveUsd: 8,
        destinationCredits: "8",
        destinationDebits: "9",
        borrowedUsd: 14,
        repaidUsd: 17,
      }),
    ]);
  });
});

describe("deriveCashSafeData", () => {
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
