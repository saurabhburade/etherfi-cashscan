import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { historicalPriceAt, historicalPriceConstants } from "../src/historical-price-buckets.js";

const WEETH = "0x01f0a31698c4d065659b9bdc21b3610292a1c506";
const LEGACY_WEETH = "0xca0bfd5f735924e34cc567146989e467ffbbce1a";
const USDT = "0xf55bec9cafdbe8730f096aa55dad6d22d44099df";
const SCR = "0xd29687c813d741e2f938f4ac377128810e217b1b";
const ETHFI = "0x056a5fa5da84ceb7f93d36e545c5905607d8bd81";

describe("checked-in historical price buckets", () => {
  it("resolves the affected Scroll weETH event with one direct 15-minute bucket lookup", () => {
    const price = historicalPriceAt(534352, WEETH, 1_732_706_470n);
    expect(price).toMatchObject({
      asset: "WEETH",
      bucketId: "1925229",
      priceUsdE18: 3_634_144_130_290_968_563_616n,
      source: "chainlink_cross_chain_historical_15m",
      sourceChainId: 10,
    });
    expect(price?.bucketStart.toISOString()).toBe("2024-11-27T11:15:00.000Z");
    expect(price?.sourceAddresses).toEqual([
      "0xb4479d436dda5c1a79bd88d282725615202406e3",
      "0x13e3ee699d1909e989722e753853ae30b17e08c5",
    ]);
  });

  it("maps the legacy Scroll weETH contract to the same direct price buckets", () => {
    const timestamp = Date.parse("2025-01-15T21:20:29Z") / 1000;
    const modern = historicalPriceAt(534352, WEETH, timestamp);
    const legacy = historicalPriceAt(534352, LEGACY_WEETH, timestamp);
    expect(legacy?.priceUsdE18).toBe(modern?.priceUsdE18);
    expect(legacy?.asset).toBe("WEETH");
    expect(legacy?.sourceIdentifier).toContain(LEGACY_WEETH);
  });

  it("resolves same-chain USDT and SCR oracle snapshots with USD-e18 scaling", () => {
    expect(historicalPriceAt(534352, USDT, 1_732_706_470n)?.priceUsdE18).toBe(999_980_000_000_000_000n);
    expect(historicalPriceAt(534352, SCR, Date.parse("2025-02-06T09:46:00Z") / 1000)?.priceUsdE18).toBe(
      598_850_000_000_000_000n,
    );
  });

  it("uses checked-in Binance candles before the first SCR oracle update", () => {
    const preOracle = historicalPriceAt(534352, SCR, Date.parse("2024-11-29T14:00:21Z") / 1000);
    expect(preOracle?.source).toBe("binanceScrUsdt");
    expect(preOracle?.sourceAddresses).toEqual(["SCRUSDT"]);
    expect(preOracle?.priceUsdE18).toBeGreaterThan(0n);
    expect(historicalPriceAt(534352, SCR, Date.parse("2024-11-22T17:00:40Z") / 1000)).toBeNull();
  });

  it("prices the January SCR balance event that previously remained unavailable", () => {
    expect(historicalPriceAt(534352, SCR, Date.parse("2025-01-01T10:36:11Z") / 1000)).toMatchObject({
      priceUsdE18: 941_000_000_000_000_000n,
      source: "binanceScrUsdt",
    });
  });

  it("switches SCR pricing to its same-chain oracle without a runtime search", () => {
    expect(historicalPriceAt(534352, SCR, Date.parse("2025-02-06T09:44:59Z") / 1000)?.source).toBe("binanceScrUsdt");
    expect(historicalPriceAt(534352, SCR, Date.parse("2025-02-06T09:45:00Z") / 1000)?.source).toBe("scrollScrUsd");
  });

  it("prices Scroll ETHFI from checked-in cross-chain buckets while its PriceProvider route reverts", () => {
    expect(historicalPriceAt(534352, ETHFI, Date.parse("2025-05-05T15:47:02Z") / 1000)).toMatchObject({
      asset: "ETHFI",
      priceUsdE18: 511_000_000_000_000_000n,
      source: "binanceEthfiUsdt",
      sourceChainId: 0,
      sourceAddresses: ["ETHFIUSDT"],
    });
  });

  it("uses the ETHFI constant only for the verified provider-revert interval", () => {
    expect(historicalPriceAt(534352, ETHFI, Date.parse("2025-04-30T16:11:29Z") / 1000)).toBeNull();
    expect(historicalPriceAt(534352, ETHFI, Date.parse("2025-04-30T16:11:30Z") / 1000)).not.toBeNull();
    expect(historicalPriceAt(534352, ETHFI, Date.parse("2025-05-08T15:53:23Z") / 1000)).not.toBeNull();
    expect(historicalPriceAt(534352, ETHFI, Date.parse("2025-05-08T15:53:24Z") / 1000)).toBeNull();
  });

  it("enforces exact validity boundaries independently of a partially covered bucket", () => {
    expect(historicalPriceAt(534352, WEETH, Date.parse("2024-11-27T11:21:09Z") / 1000)).toBeNull();
    expect(historicalPriceAt(534352, WEETH, Date.parse("2025-03-24T18:15:33Z") / 1000)).not.toBeNull();
    expect(historicalPriceAt(534352, WEETH, Date.parse("2025-03-24T18:15:34Z") / 1000)).toBeNull();
  });

  it("contains complete direct-key coverage wherever each verified source is available", () => {
    const constants = historicalPriceConstants();
    const expectedCounts: Record<string, number> = {
      [`534352:${WEETH}`]: 11_261,
      [`534352:${USDT}`]: 11_718,
      [`534352:${SCR}`]: 11_718,
      [`534352:${ETHFI}`]: 768,
    };
    for (const [routeId, expectedCount] of Object.entries(expectedCounts)) {
      const prices = constants.routes[routeId].pricesByBucketId!;
      expect(Object.keys(prices)).toHaveLength(expectedCount);
      expect(Object.values(prices).every((price) => BigInt(price) > 0n)).toBe(true);
    }
  });

  it("keeps runtime lookup free of block search and network access", () => {
    const source = readFileSync(new URL("../src/historical-price-buckets.ts", import.meta.url), "utf8");
    expect(source).toContain("priceRoute.pricesByBucketId[bucketId]");
    expect(source).not.toMatch(/fetch\s*\(|eth_call|eth_getBlock|binary/i);
  });

  it("pins the verified source contracts used by the generator", () => {
    const constants = historicalPriceConstants();
    expect(constants.sources).toMatchObject({
      optimismWeethEth: {
        address: "0x818e89b7fc0df4683a4d3768c4fdf2612a73277a",
        proxyAddress: "0xb4479d436dda5c1a79bd88d282725615202406e3",
      },
      optimismEthUsd: {
        address: "0x02f5e9e9dcc66ba6392f6904d5fcf8625d9b19c9",
        proxyAddress: "0x13e3ee699d1909e989722e753853ae30b17e08c5",
      },
      scrollUsdtUsd: {
        address: "0xe863c747c127ef8cd543f3f8975e7a4ab7abb0f3",
        proxyAddress: "0xf376a91ae078927eb3686d6010a6f1482424954e",
      },
      scrollScrUsd: {
        address: "0x145234c9c1f1583e710bdc2926d6e97e4523ef93",
      },
      binanceScrUsdt: {
        address: "SCRUSDT",
        event: "15m kline open",
      },
      binanceEthfiUsdt: {
        address: "ETHFIUSDT",
        event: "15m kline open",
      },
    });
  });
});
