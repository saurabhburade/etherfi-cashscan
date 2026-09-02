import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Envio mixed-source fetch policy", () => {
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
  });

  it("provides several independent sync fallbacks on each indexed chain", () => {
    const optimism = /- id: 10\n([\s\S]*?)(?=\n {2}- id: 534352)/.exec(config)?.[1] ?? "";
    const scroll = /- id: 534352\n([\s\S]*)/.exec(config)?.[1] ?? "";

    expect(optimism.match(/for: fallback/g)?.length).toBeGreaterThanOrEqual(2);
    expect(scroll.match(/for: fallback/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
