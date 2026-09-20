import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Envio HyperSync-only fetch policy", () => {
  const config = read("../config.yaml");
  const workspace = read("../../../pnpm-workspace.yaml");
  const patch = read("../../../patches/envio@3.6.1.patch");

  it("keeps the scheduler patch durable across installs", () => {
    expect(workspace).toContain("envio@3.6.1: patches/envio@3.6.1.patch");
    expect(patch).toContain('"ENVIO_MAX_CHAIN_CONCURRENCY"');
    expect(patch).toContain('"ENVIO_MAX_IN_FLIGHT_CHUNKS_PER_PARTITION"');
    expect(patch).toContain("rateLimitedUntilMs");
    expect(patch).toContain("immediately switching to a fallback source");
    expect(patch).toContain("Source.ProviderUnavailable");
    expect(patch).toContain("Some(-32016)");
    expect(patch).toContain("~propagateErrors=true");
    expect(patch).toContain("LazyLoader.timeoutAfter(15_000)");
    expect(patch).toContain("WithSuggestedToBlock(_) as retry");
    expect(patch).toContain("Attach rejection handlers to both boundary requests immediately");
    expect(patch).toContain("let (latestFetchedBlockInfo, optFirstBlockParent) = await Promise.all2");
    expect(patch).toContain("Optional user-defined logical identity for effect calls");
    expect(patch).toContain("input->makeCacheKey->Utils.Hash.makeOrThrow");
  });

  it("disables RPC sources and indexes directly with reorg rollback", () => {
    const optimism = /- id: 10\n([\s\S]*?)(?=\n {2}- id: 534352)/.exec(config)?.[1] ?? "";
    const scroll = /- id: 534352\n([\s\S]*)/.exec(config)?.[1] ?? "";

    expect(optimism).not.toMatch(/^\s+rpc:/m);
    expect(scroll).not.toMatch(/^\s+rpc:/m);
    expect(config).toContain("rollback_on_reorg: true");
    expect(optimism).toContain("block_lag: 0");
    expect(scroll).toContain("block_lag: 0");
  });

  it("allows block lag changes when resuming existing indexed data", async () => {
    const Config = await import(new URL("../node_modules/envio/src/Config.res.mjs", import.meta.url).href);
    const makeConfig = (optimismBlockLag: number, scrollBlockLag: number) => ({
      evm: {
        chains: {
          optimism: { blockLag: optimismBlockLag, contracts: {} },
          scroll: { blockLag: scrollBlockLag, contracts: {} },
        },
      },
    });

    expect(Config.diffPaths(makeConfig(1000, 1500), makeConfig(0, 0))).toEqual([]);
  });
});
