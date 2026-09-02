// These are intentionally deep imports from the pinned Envio version we patch.
// @ts-expect-error Envio does not publish declarations for its internal ReScript modules.
import * as LazyLoader from "envio/src/LazyLoader.res.mjs";
// @ts-expect-error Envio does not publish declarations for its internal ReScript modules.
import * as Rpc from "envio/src/sources/Rpc.res.mjs";
// @ts-expect-error Envio does not publish declarations for its internal ReScript modules.
import * as RpcSource from "envio/src/sources/RpcSource.res.mjs";
// @ts-expect-error Envio does not publish declarations for its internal ReScript modules.
import * as Source from "envio/src/sources/Source.res.mjs";
// @ts-expect-error Envio does not publish declarations for its internal ReScript modules.
import * as SourceManager from "envio/src/sources/SourceManager.res.mjs";
import { describe, expect, it } from "vitest";

type TestSource = Record<string, unknown> & {
  getItemsOrThrow: (...args: unknown[]) => Promise<unknown>;
};

const jsonRpcError = (code: number, message: string) => ({
  RE_EXN_ID: Rpc.JsonRpcError,
  _1: { code, message },
  Error: new Error(),
});

const providerUnavailable = (message: string, cooldownMs = 1_000) => ({
  RE_EXN_ID: Source.ProviderUnavailable,
  cooldownMs,
  message,
  Error: new Error(),
});

const successfulResponse = (toBlock: number) => ({
  knownHeight: 100,
  blockHashes: [],
  parsedQueueItems: [],
  transactionStore: undefined,
  blockStore: undefined,
  fromBlockQueried: 1,
  latestFetchedBlockNumber: toBlock,
  latestFetchedBlockTimestamp: 0,
  stats: { "total time elapsed (s)": 0 },
  requestStats: [],
});

const makeSource = (
  name: string,
  sourceFor: "Sync" | "Fallback" | "Realtime",
  getItemsOrThrow: TestSource["getItemsOrThrow"],
) => ({
  name,
  sourceFor,
  chainId: 10,
  poweredByHyperSync: false,
  pollingInterval: 1_000,
  getBlockHashes: async () => ({ result: { TAG: "Ok", _0: [] }, requestStats: [] }),
  getHeightOrThrow: async () => ({ height: 100, requestStats: [] }),
  getItemsOrThrow,
  createHeightSubscription: undefined,
  onReorg: () => undefined,
});

const query = {
  partitionId: "test-partition",
  fromBlock: 1,
  toBlock: 10,
  addresses: { size: () => 0 },
  selection: {
    onEventRegistrations: [{ startBlock: undefined }],
    dependsOnAddresses: false,
    clientFilteredContracts: undefined,
  },
  itemsTarget: undefined,
};

describe("Envio RPC provider failover", () => {
  it("classifies Optimism throttling, timeouts, and 5xx without swallowing range errors", () => {
    const optimismLimit = RpcSource.classifyProviderFailure(
      jsonRpcError(-32_016, "Your IP has exceeded its requests per second capacity"),
    );
    const timeout = RpcSource.classifyProviderFailure({
      RE_EXN_ID: LazyLoader.LoaderTimeout,
      _1: "Query took longer than 15 seconds",
      Error: new Error(),
    });
    const serverFailure = RpcSource.classifyProviderFailure({
      RE_EXN_ID: "JsExn",
      _1: new Error('[rescript-rest] Unexpected response status "503"'),
    });
    const rangeLimit = RpcSource.classifyProviderFailure(
      jsonRpcError(-32_016, "query returned too many results; reduce the block range"),
    );

    expect(optimismLimit?.[0]).toBe("RpcRateLimit");
    expect(timeout?.[0]).toBe("RpcUnavailable");
    expect(serverFailure?.[0]).toBe("RpcUnavailable");
    expect(rangeLimit).toBeUndefined();
  });

  it("rejects a failed loader attempt and permits a fresh request for the same key", async () => {
    const failure = new Error("fetch failed");
    let attempts = 0;
    const loader = LazyLoader.make(
      async () => {
        attempts += 1;
        if (attempts === 1) throw failure;
        return 42;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      1_000,
      true,
    );

    await expect(LazyLoader.get(loader, "block-1")).rejects.toMatchObject({
      RE_EXN_ID: "JsExn",
      _1: failure,
    });
    expect(loader.inProgress.size).toBe(0);
    expect(loader.externalPromises.has("block-1")).toBe(false);
    await expect(LazyLoader.get(loader, "block-1")).resolves.toBe(42);
    expect(attempts).toBe(2);
  });

  it("walks through multiple fallbacks without waiting", async () => {
    let primaryCalls = 0;
    let firstFallbackCalls = 0;
    let secondFallbackCalls = 0;
    const primary = makeSource("primary", "Sync", async () => {
      primaryCalls += 1;
      throw providerUnavailable("request timed out");
    });
    const firstFallback = makeSource("fallback-a", "Fallback", async () => {
      firstFallbackCalls += 1;
      throw {
        RE_EXN_ID: Source.RateLimited,
        resetMs: 30_000,
        Error: new Error(),
      };
    });
    const secondFallback = makeSource("fallback-b", "Fallback", async () => {
      secondFallbackCalls += 1;
      return successfulResponse(10);
    });
    const manager = SourceManager.make(
      [primary, firstFallback, secondFallback],
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const response = await SourceManager.executeQuery(manager, query, 100, false);

    expect(response.latestFetchedBlockNumber).toBe(10);
    expect(primaryCalls).toBe(1);
    expect(firstFallbackCalls).toBe(1);
    expect(secondFallbackCalls).toBe(1);
    expect(SourceManager.getActiveSource(manager).name).toBe("fallback-b");
  });

  it("shrinks a range on the same source instead of failing over", async () => {
    const attemptedToBlocks: number[] = [];
    let fallbackCalls = 0;
    const primary = makeSource("primary", "Sync", async (_fromBlock, toBlock) => {
      attemptedToBlocks.push(toBlock as number);
      if (toBlock === 10) {
        throw {
          RE_EXN_ID: Source.GetItemsError,
          _1: {
            TAG: "FailedGettingItems",
            exn: new Error("range too large"),
            attemptedToBlock: 10,
            retry: { TAG: "WithSuggestedToBlock", toBlock: 5 },
          },
          Error: new Error(),
        };
      }
      return successfulResponse(toBlock as number);
    });
    const fallback = makeSource("fallback", "Fallback", async () => {
      fallbackCalls += 1;
      return successfulResponse(10);
    });
    const manager = SourceManager.make(
      [primary, fallback],
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const response = await SourceManager.executeQuery(manager, query, 100, false);

    expect(attemptedToBlocks).toEqual([10, 5]);
    expect(fallbackCalls).toBe(0);
    expect(response.latestFetchedBlockNumber).toBe(5);
  });

  it("wakes fallback head polling immediately when the realtime RPC fails", async () => {
    const realtime = {
      ...makeSource("realtime", "Realtime", async () => successfulResponse(10)),
      getHeightOrThrow: async () => {
        throw providerUnavailable("head request timed out", 1_000);
      },
    };
    const fallback = {
      ...makeSource("fallback", "Fallback", async () => successfulResponse(10)),
      getHeightOrThrow: async () => ({ height: 101, requestStats: [] }),
    };
    const manager = SourceManager.make(
      [realtime, fallback],
      true,
      60_000,
      60_000,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const height = await Promise.race([
      SourceManager.waitForNewBlock(manager, 100, true, false),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("fallback head polling did not start promptly")), 500),
      ),
    ]);

    expect(height).toBe(101);
    expect(SourceManager.getActiveSource(manager).name).toBe("fallback");
  });
});
