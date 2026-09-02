import { describe, expect, it } from "vitest";
import {
  type AccountAnalyticsMetric,
  accountAnalyticsEnabled,
  accountDaysFromEvents,
  accountDaysWithEventFallback,
  accountPriceUsd,
  accountUsd,
  aggregateAccountDays,
  aggregateAccountMetrics,
  valueAtCurrentPrice,
} from "./account-analytics";

describe("account analytics feature contract", () => {
  it("is disabled unless the additive explorer schema is explicitly enabled", () => {
    expect(accountAnalyticsEnabled).toBe(process.env.CASH_EXPLORER_SCHEMA_ENABLED === "true");
  });

  it("decodes Envio account USD-e6 and token price-e18 values at the UI boundary", () => {
    expect(accountUsd("44771342557293")).toBe(44_771_342.557293);
    expect(accountUsd("0")).toBe(0);
    expect(accountUsd(null)).toBeNull();
    expect(accountPriceUsd("2434844441000000000000")).toBe(2_434.844441);
    expect(accountPriceUsd(null)).toBeNull();
  });

  it("combines the same Safe across chains without hiding incomplete pricing", () => {
    const base: AccountAnalyticsMetric = {
      id: "10:0xsafe",
      chainId: 10,
      safeAddress: "0xSafe",
      tierId: 1,
      tokenCount: 2,
      transactionCount: 3,
      lifetimeDepositedUsd: 100,
      lifetimeSpentUsd: 40,
      lifetimeWithdrawnUsd: 5,
      lifetimeCashbackUsd: 1,
      lifetimeCashbackGeneratedUsd: 3,
      lifetimeCashbackReceivedUsd: 1,
      lifetimeCashbackGeneratedForOthersUsd: 2,
      lifetimeCashbackRegularUsd: 1,
      lifetimeCashbackSpenderUsd: 1,
      lifetimeCashbackPromotionUsd: 0,
      lifetimeCashbackReferralUsd: 1,
      lifetimeCashbackOtherUsd: 2,
      creditSpendUsd: 10,
      debitSpendUsd: 30,
      borrowedUsd: 20,
      repaidUsd: 5,
      eventLedgerOutstandingDebtUsd: 15,
      debtStatus: "event_ledger_only",
      currentBalanceUsd: 80,
      netWorthUsd: 65,
      unpricedPositionCount: 0,
      firstActivityAt: "2026-01-02T00:00:00Z",
      lastActivityAt: "2026-01-03T00:00:00Z",
    };
    const result = aggregateAccountMetrics([
      base,
      {
        ...base,
        id: "534352:0xsafe",
        chainId: 534352,
        tokenCount: 1,
        transactionCount: 2,
        lifetimeSpentUsd: 10,
        currentBalanceUsd: null,
        netWorthUsd: null,
        unpricedPositionCount: 1,
        firstActivityAt: "2026-01-01T00:00:00Z",
        lastActivityAt: "2026-01-04T00:00:00Z",
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        id: "0xsafe",
        tokenCount: 3,
        transactionCount: 5,
        lifetimeSpentUsd: 50,
        lifetimeCashbackGeneratedUsd: 6,
        lifetimeCashbackReceivedUsd: 2,
        lifetimeCashbackGeneratedForOthersUsd: 4,
        lifetimeCashbackRegularUsd: 2,
        lifetimeCashbackSpenderUsd: 2,
        lifetimeCashbackPromotionUsd: 0,
        lifetimeCashbackReferralUsd: 2,
        lifetimeCashbackOtherUsd: 4,
        currentBalanceUsd: null,
        netWorthUsd: null,
        unpricedPositionCount: 1,
        firstActivityAt: "2026-01-01T00:00:00Z",
        lastActivityAt: "2026-01-04T00:00:00Z",
      }),
    );
  });

  it("combines daily flows by UTC day across chains", () => {
    const rows = aggregateAccountDays([
      {
        day: "2026-01-01",
        depositedUsd: 10,
        spentUsd: 2,
        creditSpendUsd: 1,
        debitSpendUsd: 1,
        withdrawnUsd: 0,
        cashbackUsd: 0,
        borrowedUsd: 0,
        repaidUsd: 0,
        closingBalanceUsd: null,
        closingBalanceStatus: "not_reconstructed",
        transactionCount: 2,
        pricingCoverageRatio: 1,
      },
      {
        day: "2026-01-01",
        depositedUsd: 5,
        spentUsd: null,
        creditSpendUsd: 0,
        debitSpendUsd: null,
        withdrawnUsd: 0,
        cashbackUsd: 1,
        borrowedUsd: 0,
        repaidUsd: 0,
        closingBalanceUsd: null,
        closingBalanceStatus: "not_reconstructed",
        transactionCount: 1,
        pricingCoverageRatio: 0,
      },
    ]);

    expect(rows[0]).toEqual(
      expect.objectContaining({
        depositedUsd: 15,
        spentUsd: null,
        cashbackUsd: 1,
        transactionCount: 3,
        pricingCoverageRatio: 2 / 3,
      }),
    );
  });

  it("uses legacy token-day rows only when an account-day rollup is absent", () => {
    const base = {
      chainId: 10,
      depositedUsd: 0,
      spentUsd: 0,
      creditSpendUsd: 0,
      debitSpendUsd: 0,
      withdrawnUsd: 0,
      cashbackUsd: 0,
      borrowedUsd: 0,
      repaidUsd: 0,
      closingBalanceUsd: null,
      closingBalanceStatus: "not_reconstructed",
      transactionCount: 1,
      pricingCoverageRatio: 1,
    };
    const rows = aggregateAccountDays([
      { ...base, day: "2026-01-01", tokenId: "10:0xtoken-a", spentUsd: 30 },
      { ...base, day: "2026-01-01", tokenId: "10:0xtoken-b", spentUsd: 20 },
      { ...base, day: "2026-01-02", tokenId: "10:0xtoken-a", spentUsd: 40 },
      { ...base, day: "2026-01-02", tokenId: null, spentUsd: 40 },
    ]);

    expect(rows.map(({ day, spentUsd, transactionCount }) => ({ day, spentUsd, transactionCount }))).toEqual([
      { day: "2026-01-01", spentUsd: 50, transactionCount: 2 },
      { day: "2026-01-02", spentUsd: 40, transactionCount: 1 },
    ]);
  });

  it("reconstructs missing daily Cash flows from canonical account events", () => {
    const rows = accountDaysFromEvents([
      {
        id: "deposit",
        economicActionId: "deposit-action",
        chainId: 534352,
        category: "deposit",
        fundingMode: null,
        status: "completed",
        amountUsd: 100,
        timestamp: "2025-01-01T01:00:00Z",
      },
      {
        id: "spend",
        economicActionId: "spend-action",
        chainId: 534352,
        category: "spend",
        fundingMode: "debit",
        status: "completed",
        amountUsd: 40,
        timestamp: "2025-01-01T02:00:00Z",
      },
      {
        id: "pending-withdrawal",
        economicActionId: "withdrawal-action",
        chainId: 534352,
        category: "withdrawal",
        fundingMode: null,
        status: "pending",
        amountUsd: 25,
        timestamp: "2025-01-01T03:00:00Z",
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        day: "2025-01-01",
        depositedUsd: 100,
        spentUsd: 40,
        debitSpendUsd: 40,
        withdrawnUsd: 0,
        transactionCount: 2,
        pricingCoverageRatio: 1,
      }),
    ]);
  });

  it("uses event-derived days only where an indexed account-day row is missing", () => {
    const row = {
      chainId: 534352,
      tokenId: null,
      depositedUsd: 0,
      spentUsd: 10,
      creditSpendUsd: 0,
      debitSpendUsd: 10,
      withdrawnUsd: 0,
      cashbackUsd: 0,
      borrowedUsd: 0,
      repaidUsd: 0,
      closingBalanceUsd: null,
      closingBalanceStatus: "not_reconstructed",
      transactionCount: 1,
      pricingCoverageRatio: 1,
    };
    const rows = accountDaysWithEventFallback(
      [{ ...row, day: "2025-01-01", spentUsd: 50 }],
      [
        { ...row, day: "2025-01-01", spentUsd: 10 },
        { ...row, day: "2025-01-02", spentUsd: 20 },
      ],
    );

    expect(rows.map(({ day, spentUsd }) => ({ day, spentUsd }))).toEqual([
      { day: "2025-01-01", spentUsd: 50 },
      { day: "2025-01-02", spentUsd: 20 },
    ]);
  });

  it("values raw Safe transfer amounts with the latest indexed token price", () => {
    expect(valueAtCurrentPrice("27937720000", 6, 1)).toBe(27_937.72);
    expect(valueAtCurrentPrice("1000000000000000000", 18, 2_500)).toBe(2_500);
  });

  it("keeps missing prices distinct from a genuine zero balance", () => {
    expect(valueAtCurrentPrice("1000000", 6, null)).toBeNull();
    expect(valueAtCurrentPrice("1000000", null, 1)).toBeNull();
    expect(valueAtCurrentPrice("0", null, null)).toBe(0);
  });
});
