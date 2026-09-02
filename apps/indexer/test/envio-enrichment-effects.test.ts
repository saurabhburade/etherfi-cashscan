import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheSuccessfulResult,
  canonicalReservePlan,
  currentTokenPriceEffect,
  exactBlockTag,
  exactTokenPriceEffect,
  fifteenMinuteBucket,
  priceProviderAvailableAtBlock,
  priceProviderDeploymentFor,
  priceProviderFor,
  priceProviderUsdE6ToE18,
  rpcUrlsFor,
} from "../src/envio-enrichment-effects.js";

describe("Envio enrichment effect keys", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses a deterministic chain-scoped reserve plan without fake token addresses", () => {
    expect(
      canonicalReservePlan([
        { reserveId: "12", tokenAddress: null },
        { reserveId: 2n, tokenAddress: "0xABCDEFabcdefABCDEFabcdefabcdefabcdefABCD" },
      ]),
    ).toBe(
      '[{"reserveId":"2","tokenAddress":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"},{"reserveId":"12","tokenAddress":null}]',
    );
  });

  it("rounds price work to a fifteen-minute cache bucket", () => {
    expect(fifteenMinuteBucket(new Date("2026-01-01T10:14:59.999Z"))).toBe("2026-01-01T10:00:00.000Z");
  });

  it("deduplicates different event blocks in the same token bucket", () => {
    const effect = currentTokenPriceEffect as unknown as {
      cacheKey: (input: {
        tokenAddress: string;
        bucketStart: string;
        blockNumber?: string;
        blockHash?: string;
        blockTimestamp?: string;
      }) => string;
    };
    const shared = {
      tokenAddress: "0x0000000000000000000000000000000000000001",
      bucketStart: "2026-01-01T10:00:00.000Z",
    };

    expect(effect.cacheKey({ ...shared, blockNumber: "100", blockHash: "0x01", blockTimestamp: "1" })).toBe(
      effect.cacheKey({ ...shared, blockNumber: "200", blockHash: "0x02", blockTimestamp: "2" }),
    );
    expect(effect.cacheKey({ ...shared, bucketStart: "2026-01-01T10:15:00.000Z" })).not.toBe(effect.cacheKey(shared));
  });

  it("packs logical price calls into a bounded JSON-RPC batch", async () => {
    const requests: unknown[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Array<{ id: number }>;
        requests.push(body);
        const encodedOne = `0x${"0".repeat(63)}1`;
        return new Response(JSON.stringify(body.map(({ id }) => ({ jsonrpc: "2.0", id, result: encodedOne }))), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const handler = (
      currentTokenPriceEffect as unknown as {
        handler: (args: {
          input: Record<string, string>;
          context: { chain: { id: number }; cache: boolean };
        }) => Promise<{ status: string }>;
      }
    ).handler;
    const makeArgs = (suffix: string, bucketStart: string, blockTimestamp: string) => ({
      input: {
        tokenAddress: `0x${suffix.padStart(40, "0")}`,
        bucketStart,
        blockNumber: "149521166",
        blockHash: `0x${suffix.padStart(64, "0")}`,
        blockTimestamp,
      },
      context: { chain: { id: 10 }, cache: true },
    });

    const results = await Promise.all([
      handler(makeArgs("1", "2026-01-01T10:00:00.000Z", "1767261601")),
      handler(makeArgs("2", "2026-01-01T10:15:00.000Z", "1767262501")),
    ]);

    expect(results.map(({ status }) => status)).toEqual(["resolved", "resolved"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveLength(2);
  });

  it("does not silently configure an RPC for unsupported chains", () => {
    expect(rpcUrlsFor(1)).toEqual([]);
  });

  it("uses exact block tags with benchmarked archive fallbacks", () => {
    expect(exactBlockTag(12_345n)).toBe("0x3039");
    const current = process.env.OPTIMISM_RPC_URL;
    const archive = process.env.OPTIMISM_ARCHIVE_RPC_URL;
    const archiveFallback = process.env.OPTIMISM_ARCHIVE_RPC_FALLBACK_URL;
    const scrollArchive = process.env.SCROLL_ARCHIVE_RPC_URL;
    const scrollArchiveFallback = process.env.SCROLL_ARCHIVE_RPC_FALLBACK_URL;
    process.env.OPTIMISM_RPC_URL = "https://current.example";
    delete process.env.OPTIMISM_ARCHIVE_RPC_URL;
    delete process.env.OPTIMISM_ARCHIVE_RPC_FALLBACK_URL;
    delete process.env.SCROLL_ARCHIVE_RPC_URL;
    delete process.env.SCROLL_ARCHIVE_RPC_FALLBACK_URL;
    try {
      expect(rpcUrlsFor(10, "archive")).toEqual([
        "https://optimism.rpc.sentio.xyz",
        "https://mainnet.optimism.io",
        "https://rpc-optimism.blockmachine.io",
      ]);
      expect(rpcUrlsFor(534352, "archive")).toEqual([
        "https://scroll.rpc.sentio.xyz",
        "https://scroll.api.pocket.network",
        "https://scroll-rpc.publicnode.com",
        "https://rpc-scroll.blockmachine.io",
      ]);
    } finally {
      if (current === undefined) delete process.env.OPTIMISM_RPC_URL;
      else process.env.OPTIMISM_RPC_URL = current;
      if (archive === undefined) delete process.env.OPTIMISM_ARCHIVE_RPC_URL;
      else process.env.OPTIMISM_ARCHIVE_RPC_URL = archive;
      if (archiveFallback === undefined) delete process.env.OPTIMISM_ARCHIVE_RPC_FALLBACK_URL;
      else process.env.OPTIMISM_ARCHIVE_RPC_FALLBACK_URL = archiveFallback;
      if (scrollArchive === undefined) delete process.env.SCROLL_ARCHIVE_RPC_URL;
      else process.env.SCROLL_ARCHIVE_RPC_URL = scrollArchive;
      if (scrollArchiveFallback === undefined) delete process.env.SCROLL_ARCHIVE_RPC_FALLBACK_URL;
      else process.env.SCROLL_ARCHIVE_RPC_FALLBACK_URL = scrollArchiveFallback;
    }
  });

  it("permits the verified same-address PriceProvider on both Cash chains", () => {
    expect(priceProviderFor(10)).toBe("0x44dd2372fe7b97c4b4d6a7d4decf72466485bacb");
    expect(priceProviderFor(534352)).toBe("0x44dd2372fe7b97c4b4d6a7d4decf72466485bacb");
    expect(priceProviderFor(1)).toBeNull();
  });

  it("records the verified PriceProvider deployment boundaries", () => {
    expect(priceProviderDeploymentFor(10)).toEqual({
      blockNumber: 149_521_166n,
      timestampSeconds: 1_774_641_109n,
    });
    expect(priceProviderDeploymentFor(534352)).toEqual({
      blockNumber: 14_206_947n,
      timestampSeconds: 1_742_840_134n,
    });
    expect(priceProviderDeploymentFor(1)).toBeNull();
    expect(priceProviderAvailableAtBlock(10, 149_521_165n)).toBe(false);
    expect(priceProviderAvailableAtBlock(10, 149_521_166n)).toBe(true);
  });

  it("normalizes the PriceProvider's six-decimal USD result to E18", () => {
    expect(priceProviderUsdE6ToE18(2_342_321_528n)).toBe(2_342_321_528_000_000_000_000n);
  });

  it("single-flights current prices by token bucket while retaining exact source provenance", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/envio-enrichment-effects.ts", import.meta.url), "utf8"),
    );
    const currentPriceEffect = source.slice(
      source.indexOf("export const currentTokenPriceEffect"),
      source.indexOf("export const lendingStateSnapshotEffect"),
    );
    expect(currentPriceEffect).toContain('name: "cash_current_token_price_v5"');
    expect(currentPriceEffect).toContain("cacheKey: ({ tokenAddress, bucketStart })");
    expect(currentPriceEffect).toContain("blockNumber: S.string");
    expect(currentPriceEffect).toContain("blockHash: S.string");
    expect(currentPriceEffect).toContain("blockTimestamp: S.string");
    expect(currentPriceEffect).toContain("exactBlockReference(input.blockHash)");
    expect(currentPriceEffect).toContain("withPriceReference(result, blockNumber, input.blockHash, blockTimestamp)");
    expect(currentPriceEffect).not.toContain("eth_blockNumber");
    expect(currentPriceEffect).not.toContain("eth_getBlockByNumber");
    expect(source).not.toContain("blockAtOrBeforeTimestamp");
    expect(source).not.toContain("blockAnchorCache");
  });

  it("keeps an exact-block fallback for out-of-order bucket loaders", () => {
    const effect = exactTokenPriceEffect as unknown as {
      name: string;
      cacheKey?: unknown;
    };
    expect(effect.name).toBe("cash_exact_token_price_v1");
    expect(effect.cacheKey).toBeUndefined();
  });

  it("does not cache a bucket-wide pre-deployment miss", async () => {
    const context = { chain: { id: 10 }, cache: true };
    const handler = (
      currentTokenPriceEffect as unknown as {
        handler: (args: {
          input: Record<string, string>;
          context: { chain: { id: number }; cache: boolean };
        }) => Promise<{ status: string }>;
      }
    ).handler;
    const result = await handler({
      input: {
        tokenAddress: "0x0000000000000000000000000000000000000001",
        bucketStart: "2026-01-01T10:00:00.000Z",
        blockNumber: "149521165",
        blockHash: `0x${"1".repeat(64)}`,
        blockTimestamp: "1767261601",
      },
      context,
    });
    expect(result.status).toBe("unavailable");
    expect(context.cache).toBe(false);
  });

  it("marks unavailable and partial results non-cacheable so they can retry", () => {
    const unavailableContext = { cache: true };
    cacheSuccessfulResult(unavailableContext, { status: "unavailable", valueJson: "null", error: "archive missing" });
    expect(unavailableContext.cache).toBe(false);
    const partialContext = { cache: true };
    cacheSuccessfulResult(partialContext, { status: "partial", valueJson: "{}", error: null });
    expect(partialContext.cache).toBe(false);
  });
});
