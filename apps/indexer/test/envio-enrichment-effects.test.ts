import { describe, expect, it } from "vitest";
import {
  cacheSuccessfulResult,
  canonicalReservePlan,
  exactBlockTag,
  fifteenMinuteBucket,
  priceProviderFor,
  rpcUrlsFor,
} from "../src/envio-enrichment-effects.js";

describe("Envio enrichment effect keys", () => {
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

  it("does not silently configure an RPC for unsupported chains", () => {
    expect(rpcUrlsFor(1)).toEqual([]);
  });

  it("uses exact block tags with dRPC defaults and PublicNode fallbacks", () => {
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
      expect(rpcUrlsFor(10, "archive")).toEqual(["https://optimism.drpc.org", "https://optimism-rpc.publicnode.com"]);
      expect(rpcUrlsFor(534352, "archive")).toEqual(["https://scroll.drpc.org", "https://scroll-rpc.publicnode.com"]);
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

  it("defines timestamp-aligned cross-chain pricing without reusing a source block number", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/envio-enrichment-effects.ts", import.meta.url), "utf8"),
    );
    expect(source).toContain('name: "cash_cross_chain_token_price_v1"');
    expect(source).toContain("crossChain: true");
    expect(source).toContain("blockAtOrBeforeTimestamp(referenceChainId");
    expect(source).not.toMatch(/crossChainTokenPriceEffect[\s\S]{0,800}input\.blockNumber/);
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
