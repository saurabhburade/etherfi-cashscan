import { describe, expect, it } from "vitest";
import { deriveCashSafeData } from "./envio";

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
