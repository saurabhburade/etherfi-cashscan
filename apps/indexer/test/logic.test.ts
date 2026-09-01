import { describe, expect, it } from "vitest";
import {
  amountAtPrice,
  applyBalanceDelta,
  balanceChange,
  bytes32Label,
  classifyMovement,
  dailyMetricId,
  eventId,
  hourFromUnixSeconds,
  impliedUsdPriceE18,
  isEurRampToken,
  isLaterTokenSpend,
  priceDeviationOverHalf,
  rampAmountUsd,
  rampKindFromLabel,
  spendBucket,
  uniqueLowercase,
} from "../src/logic.js";

describe("indexer identities", () => {
  it("qualifies log identity with chain id", () => {
    expect(eventId(10, "0xABC", 4)).toBe("10:0xabc:4");
    expect(eventId(534352, "0xABC", 4)).not.toBe(eventId(10, "0xABC", 4));
  });

  it("creates UTC daily buckets", () => {
    expect(dailyMetricId(10, 1_704_067_200)).toBe("10:2024-01-01");
    expect(hourFromUnixSeconds(1_704_103_200)).toBe(10);
  });

  it("matches Dune spend profile buckets", () => {
    expect(spendBucket(5_000_000n)).toEqual({ label: "$1-$5", sortOrder: 0 });
    expect(spendBucket(50_000_001n)).toEqual({ label: "$51-$200", sortOrder: 2 });
    expect(spendBucket(12_000_000_000n)).toEqual({ label: ">$10,000", sortOrder: 6 });
  });

  it("classifies top-up and safe transfer directions", () => {
    expect(classifyMovement(false, true)).toBe("in");
    expect(classifyMovement(true, false)).toBe("out");
    expect(classifyMovement(true, true)).toBe("internal");
  });

  it("decodes bytes32 metric labels", () => {
    expect(bytes32Label(`0x${Buffer.from("CARD_SPEND").toString("hex").padEnd(64, "0")}`)).toBe("CARD_SPEND");
  });

  it("classifies ramp labels without inventing unknown categories", () => {
    expect(rampKindFromLabel("FIAT_ONRAMP_USDC")).toBe("onramp");
    expect(rampKindFromLabel("off-ramp")).toBe("offramp");
    expect(rampKindFromLabel("CARD_SPEND")).toBe("other");
  });

  it("converts EURC ramp snapshots with the indexed EUR/USD answer", () => {
    expect(isEurRampToken("EURC")).toBe(true);
    expect(rampAmountUsd(100_000_000n, "EURC", 117_500_000n)).toEqual({
      amountUsd: 117_500_000n,
      fxStatus: "chainlink",
    });
    expect(rampAmountUsd(100_000_000n, "USDC", 117_500_000n)).toEqual({
      amountUsd: 100_000_000n,
      fxStatus: "not_required",
    });
    expect(rampAmountUsd(100_000_000n, "EURC")).toEqual({
      amountUsd: 0n,
      fxStatus: "unavailable",
    });
  });

  it("merges same-token balance deltas and normalizes distinct token keys", () => {
    const afterTopUps = applyBalanceDelta(applyBalanceDelta(0n, 1_000n, 0n), 250n, 0n);
    const afterFirstSpendLeg = applyBalanceDelta(afterTopUps, 0n, 275n);
    expect(applyBalanceDelta(afterFirstSpendLeg, 0n, 25n)).toBe(950n);
    expect(applyBalanceDelta(0n, 0n, 50n)).toBe(-50n);
    expect(balanceChange(20n, 0n)).toBe(-20n);
    expect(balanceChange(20n, 35n)).toBe(15n);
    expect(uniqueLowercase(["0xAbC", "0xabc", "0xDEF"])).toEqual(["0xabc", "0xdef"]);
  });

  it("derives a normalized USD price from a Spend token leg", () => {
    expect(impliedUsdPriceE18(155_160_000n, 155_160_000n, 6)).toBe(10n ** 18n);
    expect(impliedUsdPriceE18(50_000_000n, 100_000_000n, 6)).toBe(2n * 10n ** 18n);
    expect(impliedUsdPriceE18(0n, 100_000_000n, 6)).toBe(0n);
  });

  it("rejects only price deviations greater than fifty percent", () => {
    const oneDollar = 10n ** 18n;
    expect(priceDeviationOverHalf(15n * 10n ** 17n, oneDollar)).toBe(false);
    expect(priceDeviationOverHalf(1_500_000_000_000_000_001n, oneDollar)).toBe(true);
    expect(priceDeviationOverHalf(5n * 10n ** 17n, oneDollar)).toBe(false);
    expect(priceDeviationOverHalf(499_999_999_999_999_999n, oneDollar)).toBe(true);
  });

  it("reprices the complete Scroll USDC borrow aggregate at the indexed one-dollar price", () => {
    expect(amountAtPrice(52_981_545_913_494n, 10n ** 18n, 6)).toBe(52_981_545_913_494n);
  });

  it("keeps the latest token valuation deterministic across equal timestamps", () => {
    const current = { timestamp: 100n, blockNumber: 20n, logIndex: 4, id: "10:0xbbb:4:0" };
    expect(isLaterTokenSpend({ timestamp: 101n, blockNumber: 1n, logIndex: 0, id: "older-block" }, current)).toBe(true);
    expect(isLaterTokenSpend({ timestamp: 100n, blockNumber: 21n, logIndex: 0, id: "newer-block" }, current)).toBe(
      true,
    );
    expect(isLaterTokenSpend({ timestamp: 100n, blockNumber: 20n, logIndex: 5, id: "newer-log" }, current)).toBe(true);
    expect(isLaterTokenSpend({ timestamp: 100n, blockNumber: 20n, logIndex: 4, id: "10:0xaaa:4:0" }, current)).toBe(
      true,
    );
    expect(isLaterTokenSpend({ timestamp: 100n, blockNumber: 20n, logIndex: 4, id: "10:0xccc:4:0" }, current)).toBe(
      false,
    );
  });
});
