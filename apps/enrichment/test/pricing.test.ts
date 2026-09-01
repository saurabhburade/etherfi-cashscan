import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { applyObservation, historicalPrice, normalizeEventImpliedPrice, verifyCandidate } from "../src/pricing.js";

describe("pricing", () => {
  it("normalizes event implied prices for common token decimals", () => {
    for (const decimals of [6, 8, 18])
      assert.equal(normalizeEventImpliedPrice(10n ** BigInt(decimals), 2_000_000n, decimals), 2n * 10n ** 18n);
    assert.equal(normalizeEventImpliedPrice(1n, 1n, 256), null);
  });
  it("requires verification beyond a fifty percent candidate deviation", () => {
    const first = {
      id: "a",
      chainId: 1,
      tokenAddress: "0xt",
      source: "chainlink" as const,
      priceUsdE18: 100n,
      observedAt: "2026-01-01T00:00:00.000Z",
      blockNumber: "1",
      finalized: true,
    };
    const state = applyObservation({ observations: [], current: new Map(), candidates: [] }, first).state;
    const candidate = applyObservation(state, { ...first, id: "b", priceUsdE18: 151n });
    assert.equal(candidate.accepted, false);
    assert.equal(verifyCandidate(candidate.state, "b", 151n).current.get("1:0xt")?.priceUsdE18, 151n);
  });
  it("does not use current cache as historical fallback", () => {
    assert.equal(historicalPrice([], 1, "0xt", new Date(), "10"), null);
  });
});
