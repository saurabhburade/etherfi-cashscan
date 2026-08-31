import { describe, expect, it } from "vitest";
import { CHAIN_IDS, CHAINS, CONTRACTS, INDEXED_CHAIN_BY_ID, INDEXED_CHAINS } from "../src/index.js";

describe("contract registry", () => {
  it("uses a chain-qualified identity for deterministic addresses", () => {
    const repeated = CONTRACTS.filter((item) => item.address === "0xf4e147db314947fc1275a8cbb6cde48c510cd8cf");
    expect(repeated.length).toBeGreaterThan(2);
    expect(new Set(repeated.map((item) => `${item.chainId}:${item.address}`)).size).toBe(repeated.length);
  });

  it("covers Cash, top-up source, and legacy roles", () => {
    expect(new Set(CHAINS.map((chain) => chain.role))).toEqual(new Set(["cash", "source", "legacy"]));
  });

  it("exposes only destination-ledger chains as actively indexed", () => {
    expect(INDEXED_CHAINS.map((chain) => chain.id)).toEqual([CHAIN_IDS.optimism, CHAIN_IDS.scroll]);
    expect(INDEXED_CHAIN_BY_ID.get(CHAIN_IDS.optimism)?.name).toBe("Optimism");
    expect(INDEXED_CHAIN_BY_ID.get(CHAIN_IDS.scroll)?.name).toBe("Scroll");
  });
});
