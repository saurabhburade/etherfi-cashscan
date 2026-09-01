import { describe, expect, it } from "vitest";
import { auditPriceCoverage } from "../src/price-audit.js";

describe("price coverage audit", () => {
  const token = {
    chainId: 10,
    address: "0x0000000000000000000000000000000000000001",
    symbol: "USDC",
    decimalsVerified: true,
    metadataStatus: "verified",
    oracleAddress: "0x0000000000000000000000000000000000000002",
    oraclePair: "USDC/USD",
    price: "1000000000000000000",
    latestSpendPriceUsdE18: "1000000000000000000",
  };

  it("separates historical event USD coverage from a current-price candidate", () => {
    const report = auditPriceCoverage(
      [
        {
          category: "topup",
          chainId: 10,
          tokenAddress: token.address,
          amountRaw: "1000000",
          amountUsdRaw: null,
          transactionHash: "0xtopup",
        },
      ],
      [token],
      [],
    );
    expect(report.summary.eventUsdCoveragePercent).toBe(0);
    expect(report.summary.currentPriceCandidateCoveragePercent).toBe(100);
    expect(report.summary.allHistoricalEventsPriced).toBe(false);
  });

  it("recognizes exact event-implied pricing", () => {
    const report = auditPriceCoverage(
      [
        {
          category: "spend",
          chainId: 10,
          tokenAddress: token.address,
          amountRaw: "1000000",
          amountUsdRaw: "1000000",
          explicitPriceUsdE18: "1000000000000000000",
          transactionHash: "0xspend",
        },
      ],
      [token],
      [],
    );
    expect(report.summary.eventUsdCoveragePercent).toBe(100);
    expect(report.summary.allHistoricalEventsPriced).toBe(true);
  });
});
