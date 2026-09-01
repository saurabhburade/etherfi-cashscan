import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runBackfill } from "../src/backfill.js";
import type { Checkpoint } from "../src/cursor.js";
import type { SourceAdapter, SourcePage } from "../src/types.js";

const page: SourcePage = {
  protocolEvents: [],
  spends: [
    {
      id: "1:0x1:1",
      chainId: 1,
      transactionHash: "0x1",
      logIndex: 1,
      blockNumber: "10",
      timestamp: "2026-01-01T00:00:00.000Z",
      safe: "0xs",
      txId: "t",
      mode: 0,
      totalUsd: "1",
      usdDecimals: 6,
      tokens: [],
      amounts: [],
      amountsUsd: [],
      dataAvailability: "onchain",
    },
  ],
  spendLegs: [],
  topUps: [],
  repayments: [],
  debtEvents: [],
  cashback: [],
  withdrawals: [],
  safeBalances: [],
  tokens: [],
  priceFeeds: [],
};
describe("backfill", () => {
  it("advances only to the newest saturated feed tail when GraphQL feeds are imbalanced", async () => {
    const rawEvent = (id: string, timestamp: string, blockNumber: string) => ({
      id,
      chainId: 10,
      contractAddress: "0x0000000000000000000000000000000000000001",
      eventType: "configured",
      actor: "0x0000000000000000000000000000000000000000",
      tokenAddress: "0x0000000000000000000000000000000000000000",
      amount: "0",
      amountUsd: null,
      blockNumber,
      timestamp,
      transactionHash: `0x${id.padStart(64, "0")}`,
      logIndex: 0,
      metadata: "{}",
    });
    let checkpoint: Checkpoint | null = null;
    await runBackfill(
      {
        fetchPage: async () => ({
          ...page,
          protocolEvents: [
            rawEvent("1", "2026-01-01T00:30:00.000Z", "30"),
            rawEvent("2", "2026-01-01T00:20:00.000Z", "20"),
          ],
          lendingSourceEvents: [
            {
              ...rawEvent("3", "2026-01-01T00:01:00.000Z", "1"),
              sourceKind: "spoke",
              sourceAddress: "0x0000000000000000000000000000000000000002",
              marketAddress: "0x0000000000000000000000000000000000000002",
              spokeAddress: "0x0000000000000000000000000000000000000002",
              eventType: "borrow",
              safeAddress: "0x0000000000000000000000000000000000000003",
              actorAddress: null,
              recipientAddress: null,
              reserveId: "1",
              collateralReserveId: null,
              debtReserveId: null,
            },
          ],
        }),
      },
      {
        tryAdvisoryLock: async () => true,
        readCheckpoint: async () => null,
        writeProjection: async () => {},
        writeCheckpoint: async (next) => {
          checkpoint = next;
        },
      },
      "test",
      2,
    );
    assert.equal((checkpoint as Checkpoint | null)?.cursor?.id, "2");
  });

  it("uses an advisory lock and commits a deterministic checkpoint after idempotent write", async () => {
    let checkpoint: Checkpoint | null = null;
    let writes = 0;
    const store = {
      tryAdvisoryLock: async () => true,
      readCheckpoint: async () => checkpoint,
      writeProjection: async () => {
        writes += 1;
      },
      writeCheckpoint: async (next: Checkpoint) => {
        checkpoint = next;
      },
    };
    const adapter: SourceAdapter = { fetchPage: async () => page };
    await runBackfill(adapter, store);
    await runBackfill(
      {
        fetchPage: async (after) => {
          assert.ok(after);
          return { ...page, spends: [] };
        },
      },
      store,
    );
    assert.equal(writes, 2);
    const savedCheckpoint = checkpoint as Checkpoint | null;
    assert.equal(savedCheckpoint?.cursor?.id, "1:0x1:1");
  });
  it("does nothing while another worker owns the lock", async () => {
    const result = await runBackfill(
      { fetchPage: async () => page },
      {
        tryAdvisoryLock: async () => false,
        readCheckpoint: async () => null,
        writeProjection: async () => {},
        writeCheckpoint: async () => {},
      },
    );
    assert.deepEqual(result, { processed: 0, checkpoint: null, locked: false });
  });
});
