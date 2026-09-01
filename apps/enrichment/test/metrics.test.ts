import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveAccountTokenMetrics } from "../src/metrics.js";
import type { ScannerEvent, ScannerEventTokenLeg } from "../src/types.js";

const event = (type: string, amount: bigint, role: ScannerEvent["accountingRole"] = "canonical"): ScannerEvent => ({
  id: type,
  chainId: 1,
  transactionHash: "0x",
  blockHash: null,
  sourceProvenance: "test",
  logIndex: 1,
  blockNumber: "1",
  timestamp: "2026-01-01T00:00:00.000Z",
  eventType: type,
  accountAddress: "0xs",
  tokenAddress: "0xt",
  amount,
  amountUsd: null,
  usdDecimals: 6,
  usdStatus: "unpriced",
  accountingRole: role,
  accountingDirection: null,
  accountingKind: type,
  metadata: {},
});
describe("account metrics", () => {
  it("keeps lend borrowing separate and excludes audit duplicates", () => {
    const events = [event("lend_borrowed", 3n), event("repay", 2n), event("lend_borrowed", 100n, "audit")];
    const metrics = deriveAccountTokenMetrics(events, [] as ScannerEventTokenLeg[], [
      { chainId: 1, safeAddress: "0xs", tokenAddress: "0xt", amount: "9" },
    ]);
    assert.deepEqual(
      {
        lendBorrowRaw: metrics[0]?.lendBorrowRaw,
        repaymentRaw: metrics[0]?.repaymentRaw,
        safeBalanceRaw: metrics[0]?.safeBalanceRaw,
      },
      { lendBorrowRaw: 3n, repaymentRaw: 2n, safeBalanceRaw: 9n },
    );
  });

  it("separates generated, received, type buckets, and pending settlements", () => {
    const cashback = (
      id: string,
      amount: bigint,
      cashbackType: number | null,
      recipient: string,
      paid: boolean,
      accountingKind = "cashback",
    ): ScannerEvent => ({
      ...event(id, amount),
      eventType: accountingKind === "cashback_received" ? "pending_cashback_cleared" : "cashback",
      accountingKind,
      accountingDirection: accountingKind === "cashback_received" ? "credit" : null,
      metadata: { recipient, paid, cashbackType },
    });
    const safe = "0xs";
    const events = [
      cashback("spender", 10n, 1, safe, true),
      cashback("promotion", 20n, 2, "0xother", false),
      cashback("referral", 30n, 3, "0xother", true),
      cashback("settlement", 40n, null, safe, true, "cashback_received"),
    ];
    const metric = deriveAccountTokenMetrics(events, [], [])[0]!;
    assert.deepEqual(
      {
        generated: metric.cashbackGeneratedRaw,
        received: metric.cashbackReceivedRaw,
        legacyReceived: metric.cashbackRaw,
        forOthers: metric.cashbackGeneratedForOthersRaw,
        spender: metric.cashbackSpenderRaw,
        promotion: metric.cashbackPromotionRaw,
        referral: metric.cashbackReferralRaw,
        receivedCount: metric.cashbackReceivedCount,
      },
      {
        generated: 60n,
        received: 50n,
        legacyReceived: 50n,
        forOthers: 50n,
        spender: 10n,
        promotion: 20n,
        referral: 30n,
        receivedCount: 2n,
      },
    );
  });

  it("preserves uint256 type values and assigns non-enum values to other", () => {
    const generated = {
      ...event("cashback", 7n),
      amountUsd: 7n,
      metadata: { recipient: "0xother", paid: false, cashbackType: "1000" },
    };
    const received = {
      ...event("cashback", 3n),
      id: "received",
      amountUsd: 3n,
      metadata: { recipient: "0xs", paid: true, cashbackType: "0" },
    };
    const metric = deriveAccountTokenMetrics([generated, received], [], [])[0];
    assert.deepEqual(
      {
        generated: metric?.cashbackGeneratedRaw,
        received: metric?.cashbackReceivedRaw,
        forOthers: metric?.cashbackGeneratedForOthersRaw,
        regular: metric?.cashbackRegularRaw,
        other: metric?.cashbackOtherRaw,
      },
      { generated: 10n, received: 3n, forOthers: 7n, regular: 3n, other: 7n },
    );
  });

  it("counts a PendingCashbackCleared settlement as received but not generated", () => {
    const settlement = {
      ...event("pending_cashback_cleared", 5n),
      accountingKind: "cashback_received",
      metadata: { recipient: "0xs", paid: true },
    };
    const metric = deriveAccountTokenMetrics([settlement], [], [])[0];
    assert.deepEqual(
      { generated: metric?.cashbackGeneratedRaw, received: metric?.cashbackReceivedRaw },
      { generated: 0n, received: 5n },
    );
  });
});
