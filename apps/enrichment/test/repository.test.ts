import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatUnits, priceObservationUpsertPlan, priceSourceUpsertPlan } from "../src/repository.js";

describe("persistence units", () => {
  it("formats exact USD values without Number rounding", () => {
    assert.equal(formatUnits(1_234_567n, 6), "1.234567");
    assert.equal(formatUnits(1n, 6), "0.000001");
    assert.equal(formatUnits(2n * 10n ** 18n, 18), "2.000000000000000000");
  });

  it("keeps historical and current PriceProvider sources relationally distinct", () => {
    const base = {
      id: "observation",
      chainId: 10,
      tokenAddress: "0x0000000000000000000000000000000000000001",
      source: "price_provider" as const,
      priceUsdE18: 1_000_000_000_000_000_000n,
      observedAt: "2026-09-01T00:00:00.000Z",
      blockNumber: "100",
      finalized: true,
    };
    const historical = priceSourceUpsertPlan({ ...base, usage: "historical" });
    const current = priceSourceUpsertPlan({ ...base, usage: "current" });
    assert.notEqual(historical.values[0], current.values[0]);
    assert.equal(historical.values[2], "price_provider_historical");
    assert.equal(current.values[2], "current_cache");
    assert.equal(priceObservationUpsertPlan({ ...base, usage: "current" }).values[3], "current_cache");
  });
});
