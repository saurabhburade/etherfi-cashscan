import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { projectLending } from "../src/lending.js";
import {
  activityBucket,
  calculateNetWorth,
  fetchLendingStateSnapshots,
  queueFinalizedSnapshots,
  shouldRefreshSnapshot,
} from "../src/lending-snapshots.js";
import type { LendingSourceEvent, SourcePage } from "../src/types.js";

const safe = "0x0000000000000000000000000000000000000001";
const market = "0x0000000000000000000000000000000000000002";
const reserveA = "0x0000000000000000000000000000000000000003";
const reserveB = "0x0000000000000000000000000000000000000004";
const source = (
  id: string,
  eventType: LendingSourceEvent["eventType"],
  reserveAddress: string | null = reserveA,
): LendingSourceEvent => ({
  id,
  chainId: 10,
  transactionHash: "0xabc",
  logIndex: Number(id.slice(-1)),
  blockNumber: "100",
  timestamp: "2026-01-01T00:00:00.000Z",
  sourceKind: id.startsWith("g") ? "gateway" : id.startsWith("s") ? "spoke" : "cash",
  eventType,
  safeAddress: safe,
  sourceAddress: market,
  marketAddress: market,
  spokeAddress: market,
  actorAddress: null,
  recipientAddress: null,
  reserveId: reserveAddress == null ? null : reserveAddress === reserveB ? "2" : "1",
  collateralReserveId: null,
  debtReserveId: null,
  metadata: "{}",
});
const base = (
  lendingSourceEvents: LendingSourceEvent[],
): Pick<SourcePage, "lendingSourceEvents" | "lendingSourceEventLegs" | "lendingReserveStates"> => ({
  lendingSourceEvents,
  lendingSourceEventLegs: [],
  lendingReserveStates: [],
});

describe("lending projection", () => {
  it("does not collapse distinct operations in one transaction", () => {
    const projected = projectLending(
      base([
        source("c1", "supply"),
        source("g2", "supply"),
        source("s3", "collateral_enable"),
        source("c4", "supply", reserveB),
      ]),
    );
    assert.equal(
      projected.actions.length,
      3,
      "Cash/Gateway supply corroborates; collateral and another reserve do not",
    );
    assert.equal(projected.actionSources.length, 4);
    assert.equal(new Set(projected.actions.map((action) => action.actionType)).has("collateral_enable"), true);
  });
  it("keeps cash movement families such as spend and cashback distinct", () => {
    const projected = projectLending(base([source("c1", "spend", null), source("g2", "cashback", null)]));
    assert.equal(projected.actions.length, 2);
  });
  it("deduplicates corroborating Gateway and Spoke borrows while retaining both sources", () => {
    const gateway = source("g1", "borrow");
    const spoke = source("s2", "borrow");
    const legs = [gateway, spoke].map((event, index) => ({
      id: `borrow-${index}`,
      sourceEventId: event.id,
      legIndex: 0,
      legType: "borrow",
      reserveId: "1",
      tokenAddress: reserveA,
      amount: "1",
      shares: null,
      suppliedSharesDelta: null,
      drawnSharesDelta: "1",
      premiumSharesDelta: null,
      premiumOffsetRayDelta: null,
      direction: "increase" as const,
    }));
    const projected = projectLending({ ...base([gateway, spoke]), lendingSourceEventLegs: legs });
    assert.equal(projected.events.length, 2);
    assert.equal(projected.actions.length, 1);
    assert.equal(projected.actionSources.length, 2);
  });
  it("retains liquidation share deltas as legs rather than inferring a second action", () => {
    const event = source("c1", "liquidation");
    const projected = projectLending({
      ...base([event]),
      lendingSourceEventLegs: [
        {
          id: "leg",
          sourceEventId: "c1",
          legIndex: 4,
          legType: "liquidation",
          tokenAddress: reserveA,
          reserveId: "1",
          direction: "decrease",
          amount: "7",
          shares: null,
          suppliedSharesDelta: null,
          drawnSharesDelta: "2",
          premiumSharesDelta: "3",
          premiumOffsetRayDelta: "4",
        },
      ],
    });
    assert.equal(projected.actions.length, 1);
    assert.deepEqual(
      [
        projected.legs[0].drawnSharesDelta,
        projected.legs[0].premiumSharesDelta,
        projected.legs[0].premiumOffsetRayDelta,
      ],
      [2n, 3n, 4n],
    );
  });
  it("keeps a multi-leg liquidation on one action and one source link", () => {
    const event = source("c1", "liquidation");
    const leg = (id: string, legIndex: number, legType: string) => ({
      id,
      sourceEventId: "c1",
      legIndex,
      legType,
      reserveId: "1",
      tokenAddress: reserveA,
      amount: "1",
      shares: null,
      suppliedSharesDelta: null,
      drawnSharesDelta: null,
      premiumSharesDelta: null,
      premiumOffsetRayDelta: null,
      direction: "decrease" as const,
    });
    const projected = projectLending({
      ...base([event]),
      lendingSourceEventLegs: [
        leg("debt", 0, "debt_restored"),
        leg("collateral", 1, "collateral_seized"),
        leg("fee", 2, "liquidation_fee"),
      ],
    });
    assert.equal(projected.actions.length, 1);
    assert.equal(projected.actionSources.length, 1);
    assert.equal(projected.legs.length, 3);
  });
});

describe("lending snapshot scheduling", () => {
  it("coalesces finalized Safe/block changes and respects the 15 minute cadence except risk", () => {
    const events = [source("c1", "supply"), source("g2", "collateral_enable"), source("s3", "borrow")];
    const now = new Date("2026-01-01T00:10:00.000Z");
    const queued = queueFinalizedSnapshots(
      events,
      new Map([[`10:${safe}`, "2026-01-01T00:00:00.000Z"]]),
      new Map([[10, 100n]]),
      now,
    );
    assert.equal(queued.length, 1);
    assert.equal(queued[0].trigger, "risk");
    assert.equal(queued[0].reserves.length, 1);
    assert.equal(shouldRefreshSnapshot("2026-01-01T00:00:00.000Z", "normal", now), false);
    assert.equal(activityBucket("2026-01-01T00:14:59.000Z"), "2026-01-01T00:00:00.000Z");
  });
  it("uses exact archive block tags and leaves a failed archive call empty", async () => {
    let tag = "";
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (request.method === "eth_getBlockByNumber")
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { number: "0x64", hash: "0xabc" } }), {
          status: 200,
        });
      tag = request.params[1] as string;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "missing trie node" } }), {
        status: 200,
      });
    }) as typeof fetch;
    const [snapshot] = await fetchLendingStateSnapshots({
      rpcUrl: "https://archive.invalid",
      fetcher,
      requests: [
        {
          chainId: 10,
          safeAddress: safe,
          spokeAddress: market,
          reserves: [{ reserveId: 1n, tokenAddress: reserveA }],
          blockNumber: 100n,
          trigger: "historical",
        },
      ],
    });
    assert.equal(tag, "0x64");
    assert.equal(snapshot.blockHash, "0xabc");
    assert.equal(snapshot.protocolDebt, null);
    assert.match(snapshot.archiveFailure ?? "", /missing trie node/);
  });
  it("keeps wallet, supplied assets, debt, and net worth separate", () => {
    assert.equal(calculateNetWorth(10n, 100n, 30n), 80n);
    assert.equal(calculateNetWorth(null, 100n, 30n), null);
  });
});
