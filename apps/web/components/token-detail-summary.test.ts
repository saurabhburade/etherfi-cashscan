import { describe, expect, it } from "vitest";
import type { TokenAnalyticsRow } from "../lib/envio";
import { tokenMetricSummary } from "../lib/token-metric-summary";

const address = "0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff";

function row(overrides: Partial<TokenAnalyticsRow> = {}): TokenAnalyticsRow {
  return {
    chainId: 10,
    token: address,
    name: "Wrapped eETH",
    symbol: "weETH",
    decimals: 18,
    spendCount: 0,
    spendUsd: 0,
    topUpCount: 0,
    topUpAmount: "0",
    topUpUsd: null,
    withdrawalCount: 0,
    safeAccountCount: 0,
    safeInflow: "0",
    safeOutflow: "0",
    destinationCount: 0,
    reserveBalance: "0",
    reserveUsd: null,
    destinationCredits: "0",
    destinationDebits: "0",
    suppliedCount: 0,
    suppliedAmount: "0",
    borrowedCount: 0,
    borrowedAmount: "0",
    borrowedUsd: 0,
    borrowedUsdEventTime: 0,
    borrowedUsdStatus: "unpriced",
    borrowedUsdPriceUsdE18: "0",
    borrowedUsdPriceAt: "",
    borrowedUsdPriceChainId: 0,
    borrowedUsdPriceSource: "none",
    repaidCount: 0,
    repaidAmount: "0",
    repaidUsd: 0,
    ...overrides,
  };
}

describe("tokenMetricSummary", () => {
  it("keeps nonzero unpriced top-ups token-denominated across contract rows", () => {
    const summary = tokenMetricSummary(
      [
        row({ chainId: 534352, topUpCount: 2850, topUpAmount: "15830000000000000000000" }),
        row({ chainId: 10, topUpCount: 1690, topUpAmount: "4980000000000000000000" }),
        row({ chainId: 534352, token: "0x0000000000000000000000000000000000000001" }),
      ],
      "topUpAmount",
      "topUpUsd",
    );

    expect(summary).toEqual({ tokenAmount: "20.81K weETH", usd: null });
  });

  it("keeps a genuinely empty metric at zero dollars", () => {
    expect(tokenMetricSummary([row()], "topUpAmount", "topUpUsd")).toEqual({
      tokenAmount: "0 weETH",
      usd: 0,
    });
  });

  it("does not report a partial USD total when one nonzero contract row is unpriced", () => {
    const summary = tokenMetricSummary(
      [
        row({ topUpAmount: "1000000000000000000", topUpUsd: 3500 }),
        row({ chainId: 534352, topUpAmount: "2000000000000000000", topUpUsd: null }),
      ],
      "topUpAmount",
      "topUpUsd",
    );

    expect(summary).toEqual({ tokenAmount: "3 weETH", usd: null });
  });
});
