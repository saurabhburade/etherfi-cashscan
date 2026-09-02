import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

type EntityContract = {
  name: string;
  fields: readonly string[];
  indexed: readonly string[];
  population: "event" | "effect" | "event-and-effect";
};

// This is the public, source-level acceptance contract for a *fresh* Envio
// deployment.  It intentionally names the canonical analytics entities rather
// than accepting the older raw-ledger entities as substitutes.
const entities: readonly EntityContract[] = [
  {
    name: "AccountIdentity",
    fields: ["id", "address", "identityKind", "firstSeenChainId"],
    indexed: ["address"],
    population: "event",
  },
  {
    name: "AccountTokenEvent",
    fields: [
      "id",
      "account",
      "token",
      "chainId",
      "category",
      "timestamp",
      "blockNumber",
      "transactionHash",
      "logIndex",
      "legIndex",
      "amountRaw",
      "amountUsd",
      "valuationStatus",
    ],
    indexed: ["accountAddress", "tokenAddress", "category", "timestamp"],
    population: "event-and-effect",
  },
  {
    name: "AccountTokenMetric",
    fields: ["id", "account", "token", "chainId", "currentBalanceUsd", "lastActivityAt"],
    indexed: ["accountAddress", "tokenAddress", "currentBalanceUsd"],
    population: "event-and-effect",
  },
  {
    name: "AccountMetric",
    fields: ["id", "chainId", "safeAddress", "currentBalanceUsd", "netWorthUsd", "lastActivityAt"],
    indexed: ["chainId", "safeAddress", "currentBalanceUsd", "netWorthUsd"],
    population: "event-and-effect",
  },
  {
    name: "AccountDailyMetric",
    fields: ["id", "account", "chainId", "day", "transactionCount"],
    indexed: ["accountAddress", "day"],
    population: "event-and-effect",
  },
  {
    name: "EconomicAction",
    fields: ["id", "chainId", "economicKey", "actionType", "sourceCount"],
    indexed: ["chainId", "economicKey", "actionType"],
    population: "event",
  },
  {
    name: "EconomicActionSource",
    fields: ["id", "economicActionId", "sourceKind", "sourceRole"],
    indexed: ["economicActionId"],
    population: "event",
  },
  {
    name: "LendingMarket",
    fields: ["id", "chainId", "address", "spokeAddress"],
    indexed: ["chainId", "address"],
    population: "event",
  },
  {
    name: "LendingReserve",
    fields: ["id", "marketId", "chainId", "token", "reserveId"],
    indexed: ["marketId", "tokenAddress", "reserveId"],
    population: "event",
  },
  {
    name: "LendingEvent",
    fields: ["id", "chainId", "eventType", "transactionHash", "logIndex", "blockNumber", "timestamp"],
    indexed: ["chainId", "eventType", "transactionHash", "timestamp"],
    population: "event",
  },
  {
    name: "LendingEventLeg",
    fields: ["id", "lendingEventId", "tokenAddress", "legIndex", "amount", "amountUsd", "valuationStatus"],
    indexed: ["lendingEventId", "tokenAddress"],
    population: "event-and-effect",
  },
  {
    name: "LendingPosition",
    fields: ["id", "accountIdentityId", "reserveId", "chainId", "stateBlockNumber", "valuationStatus"],
    indexed: ["accountIdentityId", "reserveId", "chainId"],
    population: "event-and-effect",
  },
  {
    name: "LendingPositionSnapshot",
    fields: ["id", "lendingPositionId", "blockNumber", "snapshotKind", "stateStatus"],
    indexed: ["lendingPositionId", "blockNumber"],
    population: "event-and-effect",
  },
  {
    name: "LendingAccountSnapshot",
    fields: ["id", "accountIdentityId", "chainId", "blockNumber", "snapshotKind"],
    indexed: ["accountIdentityId", "chainId", "blockNumber"],
    population: "effect",
  },
  {
    name: "TokenPriceSource",
    fields: ["id", "tokenId", "chainId", "sourceType", "sourceIdentifier"],
    indexed: ["tokenId", "chainId", "sourceType"],
    population: "event-and-effect",
  },
  {
    name: "TokenPriceObservation",
    fields: ["id", "tokenId", "sourceId", "chainId", "observedAt", "blockNumber", "priceStatus", "priceUsdE18"],
    indexed: ["tokenId", "chainId", "observedAt", "blockNumber"],
    population: "event-and-effect",
  },
  {
    name: "TokenPriceCurrent",
    fields: ["id", "tokenId", "chainId", "observationId", "priceStatus", "priceUsdE18"],
    indexed: ["tokenId", "chainId", "priceStatus"],
    population: "event-and-effect",
  },
  {
    name: "CanonicalTokenPriceBucket",
    fields: ["id", "canonicalAsset", "tokenId", "chainId", "tokenAddress", "bucketStart", "priceUsdE18"],
    indexed: ["canonicalAsset", "tokenId", "chainId", "tokenAddress", "bucketStart"],
    population: "event",
  },
  {
    name: "CanonicalAssetPriceBucket",
    fields: [
      "id",
      "canonicalAsset",
      "bucketId",
      "bucketStart",
      "priceUsdE18",
      "sourceChainId",
      "sourceTokenAddress",
      "sourceBlockNumber",
      "sourceBlockHash",
      "sourceLogIndex",
      "sourceTimestamp",
      "sourceType",
      "sourceObservationId",
    ],
    indexed: ["canonicalAsset", "bucketId", "sourceChainId", "sourceTokenAddress", "sourceTimestamp"],
    population: "event-and-effect",
  },
  {
    name: "PriceAnomaly",
    fields: ["id", "tokenId", "candidateObservationId", "verificationStatus"],
    indexed: ["tokenId", "verificationStatus"],
    population: "event-and-effect",
  },
];

function typeSource(schema: string, name: string) {
  return new RegExp(`\\btype\\s+${name}\\b[\\s\\S]*?\\n\\}`, "m").exec(schema)?.[0];
}

function typeBody(source: string) {
  return /\{([\s\S]*?)\n\}/m.exec(source)?.[1];
}

function hasField(body: string, field: string) {
  return new RegExp(`^\\s*${field}\\s*:`, "m").test(body);
}

function isIndexed(source: string, body: string, field: string) {
  return (
    new RegExp(`^\\s*${field}\\s*:[^\\n]*@index\\b`, "m").test(body) ||
    new RegExp(`@index\\s*\\(\\s*fields\\s*:\\s*\\[[\\s\\S]*?["']${field}["']`, "m").test(source)
  );
}

describe("Envio-native Cash Explorer acceptance contract", () => {
  const schema = read("../schema.graphql");
  const handlers = read("../src/handlers/index.ts");
  const effects = [read("../src/erc20-metadata-effect.ts"), read("../src/envio-enrichment-effects.ts")].join("\n");

  it("declares the canonical entities, relation IDs, and web query indexes", () => {
    const failures: string[] = [];
    for (const contract of entities) {
      const source = typeSource(schema, contract.name);
      if (!source) {
        failures.push(`${contract.name}: missing type`);
        continue;
      }
      const body = typeBody(source);
      if (!body) {
        failures.push(`${contract.name}: malformed type declaration`);
        continue;
      }
      for (const field of contract.fields)
        if (!hasField(body, field)) failures.push(`${contract.name}.${field}: missing field`);
      for (const field of contract.indexed)
        if (!isIndexed(source, body, field))
          failures.push(`${contract.name}.${field}: missing @index for query filter/sort`);
    }
    expect(failures, `Fresh Envio GraphQL is missing canonical Cash Explorer surface:\n${failures.join("\n")}`).toEqual(
      [],
    );
  });

  it("populates every canonical entity from an Envio handler/effect seam", () => {
    const failures: string[] = [];
    // Effects return deterministic enrichment to a handler; they do not own
    // entity writes themselves. Requiring `context.Entity.set` in an effect
    // would be an Envio API-shaped false requirement.
    const hasEffectInvocation = /\bcontext\.effect\s*\(/.test(handlers);
    for (const contract of entities) {
      const setter = new RegExp(`\\bcontext\\.${contract.name}\\.set\\s*\\(`, "m");
      const presentInHandler = setter.test(handlers);
      const required = contract.population === "event" ? presentInHandler : presentInHandler && hasEffectInvocation;
      if (!required) failures.push(`${contract.name}: missing ${contract.population} population seam`);
    }
    expect(
      failures,
      `Canonical entities must be materialized by Envio code, not SQL or a worker:\n${failures.join("\n")}`,
    ).toEqual([]);
  });

  it("preserves deterministic event and leg identities, nullable pricing, and cached chain-scoped effects", () => {
    const failures: string[] = [];
    if (!/function\s+eventId\s*\([\s\S]*?chainId[\s\S]*?transactionHash[\s\S]*?logIndex/.test(read("../src/logic.ts")))
      failures.push("eventId must retain chain:transaction:log source identity");
    if (!/\$\{(?:actionId|sourceEventId)\}:\$\{legIndex\}/.test(handlers))
      failures.push("token/lending legs must append a deterministic leg index to the event identity");
    if (!/valuationStatus[\s\S]{0,500}(?:undefined|null)/.test(handlers))
      failures.push("handler valuation writes must preserve absent USD values as nullable");
    if (
      !/createEffect\s*\(/.test(effects) ||
      !/cache\s*:\s*true/.test(effects) ||
      !/crossChain\s*:\s*false/.test(effects)
    )
      failures.push("RPC effects must be cached and isolated to their indexed chain");
    if (!/blockNumber|blockTag/.test(effects))
      failures.push("RPC enrichment must request the event block, never an implicit latest block");
    expect(failures, `Fresh deployment correctness seams are incomplete:\n${failures.join("\n")}`).toEqual([]);
  });

  it("persists a complete latest-price borrow projection without overwriting event-time USD", () => {
    const metric = typeSource(schema, "TokenAnalyticsMetric");
    expect(metric).toBeDefined();
    const body = typeBody(metric ?? "") ?? "";
    for (const field of [
      "borrowedUsd",
      "borrowedUsdLatest",
      "borrowedUsdLatestStatus",
      "borrowedUsdLatestPriceUsdE18",
      "borrowedUsdLatestPriceAt",
      "borrowedUsdLatestPriceChainId",
      "borrowedUsdLatestPriceSource",
    ])
      expect(hasField(body, field), `TokenAnalyticsMetric.${field} must be part of fresh Envio GraphQL`).toBe(true);
    expect(handlers).toContain('"latest_cross_chain_price"');
    expect(handlers).toContain("amountAtPrice(borrowedAmount, borrowedUsdLatestPriceUsdE18, token.decimals)");
  });

  it("creates current token prices for transfer-only Safe balances", () => {
    expect(handlers).toContain("await resolveCanonicalValuation(context, event, tokenAddress, nextAmount)");
    expect(handlers).toContain("const nextUsd = nextAmount === 0n ? 0n : valuation?.amountUsd");
  });

  it("reuses an event-implied price when projecting an exact wallet balance", () => {
    expect(handlers).toContain(
      "applyExactWalletBalance(context, event, accountAddress, tokenAddress, exactWallet.amount, valuation)",
    );
    expect(handlers).toContain("knownValuation?.priceUsdE18");
    expect(handlers).toContain("amountAtPrice(nextAmount, knownValuation.priceUsdE18, knownValuation.tokenDecimals)");
  });

  it("does not issue cross-chain price RPC effects", () => {
    expect(handlers).not.toContain("crossChainTokenPriceEffect");
    expect(effects).not.toContain('name: "cash_cross_chain_token_price_v1"');
  });

  it("checks the common canonical bucket before invoking the same-chain price effect", () => {
    const resolver = handlers.slice(
      handlers.indexOf("async function resolveCanonicalValuation"),
      handlers.indexOf("async function canonicalTokenLeg"),
    );
    expect(resolver.indexOf("resolveCanonicalBucketValuation(")).toBeGreaterThanOrEqual(0);
    expect(resolver.indexOf("context.effect(currentTokenPriceEffect")).toBeGreaterThan(
      resolver.indexOf("resolveCanonicalBucketValuation("),
    );
    expect(resolver.indexOf("historicalPriceAt(")).toBeGreaterThan(
      resolver.indexOf("resolveCanonicalBucketValuation("),
    );
    expect(resolver.indexOf("historicalPriceAt(")).toBeLessThan(
      resolver.indexOf("context.effect(currentTokenPriceEffect"),
    );
    expect(resolver).toContain('sourceKind: "historical_constant"');
    expect(resolver).toContain('status: "historical_constant_priced"');
    expect(handlers).toContain("context.CanonicalAssetPriceBucket.set(");
    expect(resolver).toContain("blockNumber: String(event.block.number)");
    expect(resolver).toContain("blockHash: event.block.hash");
    expect(resolver).toContain("blockTimestamp: String(event.block.timestamp)");
    expect(effects).toContain('name: "cash_current_token_price_v4"');
    expect(effects).toContain("exactBlockReference(input.blockHash)");
    expect(resolver).toContain("sourceBlockNumber !== asBigInt(event.block.number)");
    expect(resolver).toContain("sourceBlockHash.toLowerCase() !== event.block.hash.toLowerCase()");
    expect(resolver).toContain("sourceTimestampSeconds !== asBigInt(event.block.timestamp)");
  });

  it("persists priced borrow, repay, and liquidation debt events", () => {
    const debtPosition = typeSource(schema, "DebtPosition");
    expect(debtPosition).toBeDefined();
    expect(hasField(typeBody(debtPosition ?? "") ?? "", "liquidatedUsd")).toBe(true);
    expect(handlers).toContain("amountUsd: valuation.amountUsd");
    expect(handlers).toContain("amountUsd: debtValuation.amountUsd");
    expect(handlers).toContain("const liquidatedUsd = current.liquidatedUsd + (debtValuation.amountUsd ?? 0n)");
    expect(handlers).not.toContain(
      'eventType: "liquidated",\n      user,\n      payer: liquidator,\n      tokenAddress: token,\n      amount,\n      amountUsd: 0n',
    );
  });
});
