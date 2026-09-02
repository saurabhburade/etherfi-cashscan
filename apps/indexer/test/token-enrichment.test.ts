import { describe, expect, it } from "vitest";
import {
  canonicalAssetPriceBucketId,
  canonicalOracleSymbol,
  findDirectUsdFeed,
  tokenFromRegistry,
  tokenPriceBucketId,
  verifiedCanonicalPriceAsset,
  verifiedCrossChainPricePeers,
} from "../src/token-enrichment.js";

describe("token oracle discovery", () => {
  const feeds = [
    {
      name: "USDC / USD",
      proxyAddress: "0x1111111111111111111111111111111111111111",
      heartbeat: 86_400,
      docs: { baseAsset: "USDC", quoteAsset: "USD", attributeType: "cex_price" },
    },
    {
      name: "USDC / EUR Exchange Rate",
      proxyAddress: "0x2222222222222222222222222222222222222222",
      docs: { baseAsset: "USDC", quoteAsset: "EUR", attributeType: "exchange_rate" },
    },
  ];

  it("maps only explicit canonical wrappers", () => {
    expect(canonicalOracleSymbol("WETH")).toBe("ETH");
    expect(canonicalOracleSymbol("USDC.e")).toBe("USDC");
    expect(canonicalOracleSymbol("FAKE-USDC")).toBe("FAKE-USDC");
  });

  it("selects a direct USD price feed and rejects other quote assets", () => {
    expect(findDirectUsdFeed(feeds, "USDC.e")?.name).toBe("USDC / USD");
    expect(findDirectUsdFeed(feeds, "EURC")).toBeUndefined();
  });

  it("uses deterministic chain-qualified metadata before the RPC effect", () => {
    expect(tokenFromRegistry(10, "0x0b2c639c533813f4aa9d7837caf62653d097ff85")).toMatchObject({
      symbol: "USDC",
      decimals: 6,
      decimalsVerified: true,
      metadataStatus: "static_verified",
    });
    expect(tokenFromRegistry(534352, "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4")).toMatchObject({
      symbol: "USDC",
      decimals: 6,
      decimalsVerified: true,
      metadataStatus: "static_verified",
    });
    expect(tokenFromRegistry(534352, "0xd29687c813d741e2f938f4ac377128810e217b1b")).toMatchObject({
      symbol: "SCR",
      decimals: 18,
      decimalsVerified: true,
      metadataStatus: "static_verified",
    });
    expect(tokenFromRegistry(534352, "0xca0bfd5f735924e34cc567146989e467ffbbce1a")).toMatchObject({
      symbol: "weETH",
      decimals: 18,
      decimalsVerified: true,
      metadataStatus: "static_verified",
    });
  });

  it("maps only registry-verified peers across Cash chains", () => {
    expect(verifiedCrossChainPricePeers(534352, "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4")).toContainEqual({
      chainId: 10,
      tokenAddress: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
      canonicalAsset: "USDC",
      decimals: 6,
    });
    expect(verifiedCrossChainPricePeers(534352, "0x1111111111111111111111111111111111111111")).toEqual([]);
    expect(verifiedCanonicalPriceAsset(534352, "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4")).toBe("USDC");
    expect(verifiedCanonicalPriceAsset(534352, "0x1111111111111111111111111111111111111111")).toBeNull();
    expect(tokenPriceBucketId(10, "0xAbC", "2026-01-01T10:00:00.000Z")).toBe("10:0xabc:2026-01-01T10:00:00.000Z");
    expect(canonicalAssetPriceBucketId(canonicalOracleSymbol("USDC.e"), 1_893_408n)).toBe("USDC:1893408");
    expect(canonicalAssetPriceBucketId("FAKE-usdc", 1_893_408n)).toBe("FAKE-usdc:1893408");
  });
});
