import { describe, expect, it } from "vitest";
import { decodeSnapshotEffectResult, planLendingSnapshots } from "../src/handlers/state-enrichment.js";

const base = {
  chainId: 10,
  safeAddress: "0xAa",
  marketId: "cash",
  spokeAddress: "0xSpoke",
  occurredAt: new Date("2026-01-01T10:04:00Z"),
  reserves: [{ reserveId: 3n, tokenAddress: null }],
};

describe("state enrichment planning", () => {
  it("does no work on a quiet system and coalesces ordinary activity in its bucket", () => {
    expect(planLendingSnapshots([], new Map())).toEqual([]);
    const plans = planLendingSnapshots(
      [
        { ...base, blockNumber: 100n, riskChanging: false },
        { ...base, blockNumber: 101n, riskChanging: false },
      ],
      new Map(),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      blockNumber: "101",
      trigger: "activity",
      reservePlan: '[{"reserveId":"3","tokenAddress":null}]',
    });
  });

  it("keeps each risk-changing block exact and does not use a prior bucket to suppress it", () => {
    const plans = planLendingSnapshots(
      [
        { ...base, blockNumber: 100n, riskChanging: true },
        { ...base, blockNumber: 101n, riskChanging: true },
      ],
      new Map([["10:0xaa:cash", "2026-01-01T10:00:00.000Z"]]),
    );
    expect(plans.map((plan) => plan.blockNumber)).toEqual(["100", "101"]);
  });

  it("preserves unavailable and partial states instead of converting them to zeroes", () => {
    expect(decodeSnapshotEffectResult({ status: "unavailable", valueJson: "null", error: "archive missing" })).toEqual({
      status: "unavailable",
      snapshot: null,
      error: "archive missing",
    });
    expect(decodeSnapshotEffectResult({ status: "partial", valueJson: '{"positions":[]}', error: null })).toEqual({
      status: "partial",
      snapshot: { positions: [] },
      error: null,
    });
  });
});
