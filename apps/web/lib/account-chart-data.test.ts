import { describe, expect, it } from "vitest";
import type { AccountAnalyticsDetail, AccountTokenAnalytics } from "./account-analytics";
import {
  accountCashbackTypeSlices,
  accountDailyChartPoints,
  accountFundingSlices,
  accountPortfolioSlices,
  accountTokenMetricSlices,
} from "./account-chart-data";

const token = (overrides: Partial<AccountTokenAnalytics>): AccountTokenAnalytics => ({
  id: "10:0xsafe:0xtoken",
  chainId: 10,
  currentBalanceAmount: "1000000",
  currentBalanceUsd: 1,
  currentBalanceValuationStatus: "priced",
  safeInflowAmount: "10000000",
  safeOutflowAmount: "9000000",
  safeBalanceAmount: "1000000",
  safeInflowUsd: 10,
  safeOutflowUsd: 9,
  currentPriceUsd: 1,
  balanceUpdatedAt: "2026-09-01T00:00:00Z",
  priceObservedAt: "2026-09-01T00:00:00Z",
  depositedAmount: "5000000",
  depositedUsd: 5,
  spentAmount: "3000000",
  spentUsd: 3,
  withdrawnAmount: "1000000",
  withdrawnUsd: 1,
  cashbackAmount: "100000",
  cashbackUsd: 0.1,
  borrowedUsd: 0,
  repaidUsd: 0,
  outstandingDebtUsd: 0,
  outstandingDebtStatus: "event_ledger_only",
  token: { address: "0xtoken", symbol: "USDC", name: "USD Coin", decimals: 6 },
  ...overrides,
});

const detail = (overrides: Partial<AccountAnalyticsDetail> = {}): AccountAnalyticsDetail => ({
  account: {
    id: "10:0xsafe",
    chainId: 10,
    safeAddress: "0xsafe",
    tierId: null,
    tokenCount: 2,
    transactionCount: 2,
    lifetimeDepositedUsd: 7,
    lifetimeSpentUsd: 4,
    lifetimeWithdrawnUsd: 1,
    lifetimeCashbackUsd: 0.1,
    lifetimeCashbackGeneratedUsd: 0.3,
    lifetimeCashbackReceivedUsd: 0.1,
    lifetimeCashbackGeneratedForOthersUsd: 0.2,
    lifetimeCashbackRegularUsd: 0.1,
    lifetimeCashbackSpenderUsd: 0.1,
    lifetimeCashbackPromotionUsd: 0,
    lifetimeCashbackReferralUsd: 0.1,
    lifetimeCashbackOtherUsd: 0.2,
    creditSpendUsd: 1,
    debitSpendUsd: 3,
    borrowedUsd: 0,
    repaidUsd: 0,
    eventLedgerOutstandingDebtUsd: 0,
    debtStatus: "event_ledger_only",
    pricedBalanceUsd: 3,
    currentBalanceUsd: 3,
    netWorthUsd: 3,
    unpricedPositionCount: 0,
    firstActivityAt: "2026-09-01T00:00:00Z",
    lastActivityAt: "2026-09-01T00:00:00Z",
  },
  chainIds: [10, 534352],
  tokens: [
    token({}),
    token({
      id: "534352:0xsafe:0xscroll",
      chainId: 534352,
      currentBalanceAmount: "2000000",
      currentBalanceUsd: 2,
      safeInflowUsd: 20,
      depositedUsd: 2,
      spentUsd: 1,
      token: { address: "0xscroll", symbol: "USDC", name: "USD Coin", decimals: 6 },
    }),
  ],
  days: [],
  activity: [],
  safeInflowUsd: 30,
  safeOutflowUsd: 18,
  balanceUpdatedAt: "2026-09-01T00:00:00Z",
  priceObservedAt: "2026-09-01T00:00:00Z",
  ...overrides,
});

describe("account chart data", () => {
  it("keeps per-token distributions distinct across networks", () => {
    expect(accountTokenMetricSlices(detail(), "safeInflowUsd").map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "USDC · Scroll", value: 20 },
      { label: "USDC · Optimism", value: 10 },
    ]);
    expect(accountTokenMetricSlices(detail(), "spentUsd").map((row) => row.value)).toEqual([3, 1]);
  });

  it("builds portfolio and funding-mode doughnuts from priced values", () => {
    expect(accountPortfolioSlices(detail()).map((row) => row.value)).toEqual([2, 1]);
    expect(accountFundingSlices(detail()).map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "Credit", value: 1 },
      { label: "Debit", value: 3 },
    ]);
  });

  it("keeps generated cashback types mutually exclusive from received cashback", () => {
    expect(accountCashbackTypeSlices(detail()).map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "Regular", value: 0.1 },
      { label: "Spender", value: 0.1 },
      { label: "Referral", value: 0.1 },
      { label: "Other / unknown", value: 0.2 },
    ]);
  });

  it("marks a daily point incomplete without converting the status to priced", () => {
    const points = accountDailyChartPoints(
      detail({
        days: [
          {
            day: "2026-09-01",
            depositedUsd: null,
            spentUsd: 4,
            creditSpendUsd: 1,
            debitSpendUsd: 3,
            withdrawnUsd: 0,
            cashbackUsd: 0.1,
            borrowedUsd: 0,
            repaidUsd: 0,
            closingBalanceUsd: null,
            closingBalanceStatus: "not_reconstructed",
            transactionCount: 1,
            pricingCoverageRatio: 0.75,
          },
        ],
      }),
    );

    expect(points[0]).toEqual(
      expect.objectContaining({
        depositedUsd: 0,
        spentUsd: 4,
        cumulativeSpendUsd: 4,
        cumulativeCashbackUsd: 0.1,
        hasUnpricedSpend: false,
        hasUnpricedCashback: false,
      }),
    );
  });

  it("builds independent cumulative spend and cashback totals", () => {
    const points = accountDailyChartPoints(
      detail({
        days: [
          {
            day: "2026-09-01",
            depositedUsd: 5,
            spentUsd: 4,
            creditSpendUsd: 1,
            debitSpendUsd: 3,
            withdrawnUsd: 3,
            cashbackUsd: 2,
            borrowedUsd: 6,
            repaidUsd: 1,
            closingBalanceUsd: null,
            closingBalanceStatus: "not_reconstructed",
            transactionCount: 6,
            pricingCoverageRatio: 1,
          },
          {
            day: "2026-09-02",
            depositedUsd: 1,
            spentUsd: 2,
            creditSpendUsd: 0,
            debitSpendUsd: 2,
            withdrawnUsd: 0,
            cashbackUsd: 0,
            borrowedUsd: 0,
            repaidUsd: 1,
            closingBalanceUsd: null,
            closingBalanceStatus: "not_reconstructed",
            transactionCount: 2,
            pricingCoverageRatio: 1,
          },
        ],
      }),
    );

    expect(points).toEqual([
      expect.objectContaining({ cashbackUsd: 2, spentUsd: 4, cumulativeSpendUsd: 4, cumulativeCashbackUsd: 2 }),
      expect.objectContaining({ cumulativeSpendUsd: 6, cumulativeCashbackUsd: 2 }),
    ]);
  });
});
