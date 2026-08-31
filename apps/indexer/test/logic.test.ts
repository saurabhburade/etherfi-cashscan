import { describe, expect, it } from "vitest";
import {
  applyBalanceDelta,
  bytes32Label,
  classifyMovement,
  dailyMetricId,
  eventId,
  hourFromUnixSeconds,
  impliedUsdPriceE18,
  isEurRampToken,
  rampAmountUsd,
  rampKindFromLabel,
  spendBucket,
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

  it("derives destination balance from top-up credits and spend debits", () => {
    const afterTopUp = applyBalanceDelta(0n, 1_000n, 0n);
    expect(applyBalanceDelta(afterTopUp, 0n, 275n)).toBe(725n);
    expect(applyBalanceDelta(0n, 0n, 50n)).toBe(-50n);
  });

  it("derives a normalized USD price from a Spend token leg", () => {
    expect(impliedUsdPriceE18(155_160_000n, 155_160_000n, 6)).toBe(10n ** 18n);
    expect(impliedUsdPriceE18(50_000_000n, 100_000_000n, 6)).toBe(2n * 10n ** 18n);
    expect(impliedUsdPriceE18(0n, 100_000_000n, 6)).toBe(0n);
  });
});
