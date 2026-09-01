import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { classifyDebtAudit, classifySpend, markDuplicates } from "../src/classifier.js";

const point = {
  id: "ignored",
  chainId: 1,
  transactionHash: "0xAB",
  logIndex: 2,
  blockNumber: "3",
  timestamp: "2026-01-01T00:00:00.000Z",
};
describe("classifier", () => {
  it("uses mode zero as credit and every other mode as debit", () => {
    assert.equal(
      classifySpend({
        ...point,
        safe: "0xSafe",
        txId: "x",
        mode: 0,
        totalUsd: "100",
        usdDecimals: 6,
        tokens: [],
        amounts: [],
        amountsUsd: [],
        dataAvailability: "onchain",
      }).metadata.accountingDirection,
      "credit",
    );
    assert.equal(
      classifySpend({
        ...point,
        safe: "0xSafe",
        txId: "x",
        mode: 2,
        totalUsd: "100",
        usdDecimals: 6,
        tokens: [],
        amounts: [],
        amountsUsd: [],
        dataAvailability: "onchain",
      }).metadata.accountingDirection,
      "debit",
    );
  });
  it("retains audit evidence separately from canonical accounting", () => {
    const canonical = classifySpend({
      ...point,
      safe: "0xSafe",
      txId: "x",
      mode: 1,
      totalUsd: null,
      usdDecimals: 6,
      tokens: [],
      amounts: [],
      amountsUsd: [],
      dataAvailability: "onchain",
    });
    const audit = classifyDebtAudit({
      ...point,
      logIndex: 3,
      user: "0xSafe",
      payer: "0x0",
      tokenAddress: "0xToken",
      amount: "2",
      amountUsd: null,
      usdStatus: "unpriced",
      eventType: "borrowed",
    });
    assert.equal(markDuplicates([canonical, audit])[1]?.accountingRole, "audit");
    assert.equal(audit.id, "1:0xab:3");
  });
});
