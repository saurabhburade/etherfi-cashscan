import { CHAIN_IDS } from "@etherfi/contracts";
import { createEffect, S } from "envio";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

/**
 * Effects in this file deliberately return a status with their value.  A failed
 * RPC result is therefore never indistinguishable from a successful zero, and
 * callers can persist an unavailable/partial row instead of inventing data.
 * Envio's per-chain cache keys include every input below.
 */
const PRICE_PROVIDER_ADDRESS = "0x44dd2372fe7b97c4b4d6a7d4decf72466485bacb" as const;
// Verified creation transactions:
// OP 0x358e17fc688ee91411dfaf920f44deb9d05da43411a106c67c0bc168f3d7e31b
// Scroll 0x8012230fb0ff025344e789edbd30b87edff4b7508e5ee114bd729118e9affb40
const PRICE_PROVIDER_DEPLOYMENTS = {
  [CHAIN_IDS.optimism]: { blockNumber: 149_521_166n, timestampSeconds: 1_774_641_109n },
  [CHAIN_IDS.scroll]: { blockNumber: 14_206_947n, timestampSeconds: 1_742_840_134n },
} as const;
const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11" as const;

const priceProviderAbi = parseAbi(["function price(address token) view returns (uint256)"]);
const PRICE_PROVIDER_DECIMALS = 6;
const RPC_TIMEOUT_MS = 8_000;

/** Ether.fi PriceProvider normalizes every USD result to six decimals. */
export function priceProviderUsdE6ToE18(priceUsdE6: bigint): bigint {
  return priceUsdE6 * 10n ** BigInt(18 - PRICE_PROVIDER_DECIMALS);
}
const spokeAbi = parseAbi([
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
  "function getUserPosition(uint256,address) view returns (uint256,uint256,uint256,uint256,uint32)",
  "function getUserSuppliedAssets(uint256,address) view returns (uint256)",
  "function getUserTotalDebt(uint256,address) view returns (uint256)",
  "function getUserReserveStatus(uint256,address) view returns (bool,bool)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const multicallAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
]);

type Address = `0x${string}`;
type RpcBlockReference = `0x${string}` | { blockHash: `0x${string}`; requireCanonical: true };
type RpcResponse = { id?: number | string; result?: unknown; error?: { message?: string } };
export type EffectValue = { status: "resolved" | "partial" | "unavailable"; valueJson: string; error: string | null };
type RpcScope = "current" | "archive";
type RpcCallResult = { ok: true; value: unknown } | { ok: false; error: string };
type PendingRpcCall = {
  method: string;
  params: unknown[];
  resolve: (result: RpcCallResult) => void;
};
type RpcBatchState = { queue: PendingRpcCall[]; running: boolean; nextDispatchAt: number };

const RPC_BATCH_SIZE = 20;
const RPC_BATCH_MIN_INTERVAL_MS = 100;
const rpcBatchStates = new Map<string, RpcBatchState>();

export const historicalTokenPriceEffect = createEffect(
  {
    name: "cash_historical_token_price_v1",
    // Cache key: (chain, tokenAddress, blockNumber). A historical call can
    // never reuse a latest/current price.
    input: { tokenAddress: S.address, blockNumber: S.string },
    output: { status: S.string, valueJson: S.string, error: S.nullable(S.string) },
    cache: true,
    crossChain: false,
    rateLimit: { calls: 10, per: "second" },
  },
  async ({ input, context }) => {
    const blockNumber = parseBlockNumber(input.blockNumber);
    const result =
      blockNumber === null
        ? unavailable("Invalid historical block number")
        : await readPrice(context.chain.id, input.tokenAddress as Address, blockTag(blockNumber), "archive");
    return cacheSuccessfulResult(context, result);
  },
);

export const currentTokenPriceEffect = createEffect(
  {
    name: "cash_current_token_price_v5",
    // The full event provenance reaches the handler, but every token has one
    // single-flight call per 15-minute bucket. A concurrent later event can win
    // that single-flight race; callers detect that case and use the exact-block
    // effect below rather than applying a future price to an earlier event.
    input: {
      tokenAddress: S.address,
      bucketStart: S.string,
      blockNumber: S.string,
      blockHash: S.string,
      blockTimestamp: S.string,
    },
    output: { status: S.string, valueJson: S.string, error: S.nullable(S.string) },
    cache: true,
    cacheKey: ({ tokenAddress, bucketStart }) => `${tokenAddress.toLowerCase()}:${bucketStart}`,
    crossChain: false,
    // Logical calls are single-flighted above, then packed into bounded JSON-RPC
    // batches below. Limiting each logical call here would recreate the large
    // preload queue even though providers receive far fewer HTTP requests.
    rateLimit: false,
  },
  async ({ input, context }) => {
    const blockNumber = parseBlockNumber(input.blockNumber);
    const blockTimestamp = parseTimestampSeconds(input.blockTimestamp);
    if (
      blockNumber === null ||
      blockTimestamp === null ||
      !isBlockHash(input.blockHash) ||
      !isTimestampInBucket(input.bucketStart, blockTimestamp)
    )
      return cacheSuccessfulResult(context, unavailable("Invalid exact current price input"));
    if (!priceProviderAvailableAtBlock(context.chain.id, blockNumber)) {
      // This cache key spans a whole bucket, which can cross the deployment
      // boundary. Never let a pre-deployment miss poison later events.
      context.cache = false;
      return unavailable("PriceProvider was not deployed at the indexed event block");
    }

    // One same-chain archive call, bound to the canonical event block hash.
    // EIP-1898 removes the need for timestamp search or a header verification
    // request while preventing a reorg replacement block from being accepted.
    const result = await readPrice(
      context.chain.id,
      input.tokenAddress as Address,
      exactBlockReference(input.blockHash),
      "archive",
    );
    return cacheSuccessfulResult(context, withPriceReference(result, blockNumber, input.blockHash, blockTimestamp));
  },
);

export const exactTokenPriceEffect = createEffect(
  {
    name: "cash_exact_token_price_v1",
    input: {
      tokenAddress: S.address,
      bucketStart: S.string,
      blockNumber: S.string,
      blockHash: S.string,
      blockTimestamp: S.string,
    },
    output: { status: S.string, valueJson: S.string, error: S.nullable(S.string) },
    cache: true,
    crossChain: false,
    // Exact-race fallbacks share the same bounded JSON-RPC batcher as the
    // bucketed path. The full input remains the cache identity for this effect.
    rateLimit: false,
  },
  async ({ input, context }) => {
    const blockNumber = parseBlockNumber(input.blockNumber);
    const blockTimestamp = parseTimestampSeconds(input.blockTimestamp);
    if (
      blockNumber === null ||
      blockTimestamp === null ||
      !isBlockHash(input.blockHash) ||
      !isTimestampInBucket(input.bucketStart, blockTimestamp)
    )
      return cacheSuccessfulResult(context, unavailable("Invalid exact price input"));
    if (!priceProviderAvailableAtBlock(context.chain.id, blockNumber))
      return unavailable("PriceProvider was not deployed at the indexed event block");

    const result = await readPrice(
      context.chain.id,
      input.tokenAddress as Address,
      exactBlockReference(input.blockHash),
      "archive",
    );
    return cacheSuccessfulResult(context, withPriceReference(result, blockNumber, input.blockHash, blockTimestamp));
  },
);

export const lendingStateSnapshotEffect = createEffect(
  {
    name: "cash_lending_state_snapshot_v1",
    // reservePlan is canonical JSON, sorted by reserve id. Thus this cache is
    // exactly (chain, safe, market/spoke, reserves, block), never latest state.
    input: {
      safeAddress: S.address,
      spokeAddress: S.address,
      marketId: S.string,
      blockNumber: S.string,
      blockHash: S.string,
      reservePlan: S.string,
    },
    output: { status: S.string, valueJson: S.string, error: S.nullable(S.string) },
    cache: true,
    crossChain: false,
    rateLimit: { calls: 4, per: "second" },
  },
  async ({ input, context }) => {
    const blockNumber = parseBlockNumber(input.blockNumber);
    const reserves = decodeReservePlan(input.reservePlan);
    const result =
      blockNumber === null || reserves === null
        ? unavailable("Invalid exact snapshot input")
        : await readLendingSnapshot(
            context.chain.id,
            input.safeAddress as Address,
            input.spokeAddress as Address,
            blockNumber,
            input.blockHash,
            reserves,
          );
    return cacheSuccessfulResult(context, result);
  },
);

export function fifteenMinuteBucket(at: Date): string {
  return new Date(Math.floor(at.getTime() / 900_000) * 900_000).toISOString();
}

export function canonicalReservePlan(
  reserves: readonly { reserveId: bigint | string; tokenAddress: string | null }[],
): string {
  return JSON.stringify(
    [...reserves]
      .map((reserve) => ({
        reserveId: BigInt(reserve.reserveId).toString(),
        tokenAddress: reserve.tokenAddress?.toLowerCase() ?? null,
      }))
      .sort((a, b) =>
        BigInt(a.reserveId) < BigInt(b.reserveId) ? -1 : BigInt(a.reserveId) > BigInt(b.reserveId) ? 1 : 0,
      ),
  );
}

async function readPrice(
  chainId: number,
  tokenAddress: Address,
  at: RpcBlockReference,
  scope: RpcScope,
): Promise<EffectValue> {
  const provider = priceProviderFor(chainId);
  if (!provider) return unavailable("No verified PriceProvider for this chain; use event-emitted prices");
  const data = encodeFunctionData({ abi: priceProviderAbi, functionName: "price", args: [tokenAddress] });
  const rpc = await batchedRpcCall(chainId, scope, "eth_call", [{ to: provider, data }, at]);
  if (!rpc.ok) return unavailable(rpc.error);
  try {
    if (typeof rpc.value !== "string") return unavailable("Price RPC returned an invalid payload");
    const priceUsdE6 = decodeFunctionResult({
      abi: priceProviderAbi,
      functionName: "price",
      data: rpc.value as `0x${string}`,
    });
    if (priceUsdE6 <= 0n) return unavailable("PriceProvider returned a zero price");
    return resolved({
      priceUsdE6: priceUsdE6.toString(),
      priceUsdE18: priceProviderUsdE6ToE18(priceUsdE6).toString(),
      ...(typeof at === "string" ? { blockTag: at } : { blockReference: at }),
    });
  } catch (error) {
    return unavailable(errorMessage(error));
  }
}

type Reserve = { reserveId: bigint; tokenAddress: Address | null };
async function readLendingSnapshot(
  chainId: number,
  safeAddress: Address,
  spokeAddress: Address,
  blockNumber: bigint,
  expectedBlockHash: string,
  reserves: Reserve[],
): Promise<EffectValue> {
  const tag = blockTag(blockNumber);
  // Verify the archive node has this exact block before doing one multicall.
  const header = await rpcCall(chainId, "archive", "eth_getBlockByNumber", [tag, false]);
  if (!header.ok) return unavailable(header.error);
  const parsedHeader = parseHeader(header.value, tag);
  if (!parsedHeader) return unavailable("Exact block header unavailable");
  if (expectedBlockHash && parsedHeader.toLowerCase() !== expectedBlockHash.toLowerCase())
    return unavailable("Archive RPC block hash does not match the indexed event block");
  const calls = [spokeCall(spokeAddress, "getUserAccountData", [safeAddress])];
  for (const reserve of reserves) {
    calls.push(spokeCall(spokeAddress, "getUserPosition", [reserve.reserveId, safeAddress]));
    calls.push(spokeCall(spokeAddress, "getUserSuppliedAssets", [reserve.reserveId, safeAddress]));
    calls.push(spokeCall(spokeAddress, "getUserTotalDebt", [reserve.reserveId, safeAddress]));
    calls.push(spokeCall(spokeAddress, "getUserReserveStatus", [reserve.reserveId, safeAddress]));
    if (reserve.tokenAddress) calls.push(erc20Call(reserve.tokenAddress, safeAddress));
  }
  const data = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [calls] });
  const response = await rpcCall(chainId, "archive", "eth_call", [{ to: MULTICALL3_ADDRESS, data }, tag]);
  if (!response.ok) return unavailable(response.error);
  try {
    if (typeof response.value !== "string") return unavailable("Snapshot RPC returned an invalid payload");
    const values = decodeFunctionResult({
      abi: multicallAbi,
      functionName: "aggregate3",
      data: response.value as `0x${string}`,
    });
    const snapshot = decodeSnapshotValues(values, reserves);
    return snapshot.partial
      ? partial({ blockHash: parsedHeader, blockNumber: blockNumber.toString(), ...snapshot })
      : resolved({ blockHash: parsedHeader, blockNumber: blockNumber.toString(), ...snapshot });
  } catch (error) {
    return unavailable(errorMessage(error));
  }
}

function decodeSnapshotValues(values: readonly { success: boolean; returnData: `0x${string}` }[], reserves: Reserve[]) {
  let offset = 0;
  let partialResult = false;
  const account = values[offset++]?.success
    ? (decodeSpoke("getUserAccountData", values[0].returnData) as readonly bigint[])
    : null;
  if (!account) partialResult = true;
  const positions = reserves.map((reserve) => {
    const position = values[offset++];
    const supplied = values[offset++];
    const debt = values[offset++];
    const status = values[offset++];
    const balance = reserve.tokenAddress ? values[offset++] : undefined;
    const p = position?.success ? (decodeSpoke("getUserPosition", position.returnData) as readonly bigint[]) : null;
    const s = status?.success ? (decodeSpoke("getUserReserveStatus", status.returnData) as readonly boolean[]) : null;
    const wallet = balance?.success
      ? decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: balance.returnData })
      : null;
    if (!p || !supplied?.success || !debt?.success || !s || (reserve.tokenAddress && !balance?.success))
      partialResult = true;
    return {
      reserveId: reserve.reserveId.toString(),
      walletBalance: wallet?.toString() ?? null,
      suppliedBalance: supplied?.success
        ? (decodeSpoke("getUserSuppliedAssets", supplied.returnData) as bigint).toString()
        : null,
      totalDebt: debt?.success ? (decodeSpoke("getUserTotalDebt", debt.returnData) as bigint).toString() : null,
      drawnShares: p?.[0]?.toString() ?? null,
      premiumShares: p?.[1]?.toString() ?? null,
      premiumOffsetRay: p?.[2]?.toString() ?? null,
      suppliedShares: p?.[3]?.toString() ?? null,
      enabledAsCollateral: s?.[0] ?? null,
      borrowed: s?.[1] ?? null,
    };
  });
  return { partial: partialResult, account: account?.map(String) ?? null, positions };
}

type SpokeFunction =
  | "getUserAccountData"
  | "getUserPosition"
  | "getUserSuppliedAssets"
  | "getUserTotalDebt"
  | "getUserReserveStatus";
function spokeCall(target: Address, functionName: SpokeFunction, args: readonly unknown[]) {
  return {
    target,
    allowFailure: true,
    callData: encodeFunctionData({ abi: spokeAbi, functionName, args: args as never }),
  };
}
function erc20Call(target: Address, safeAddress: Address) {
  return {
    target,
    allowFailure: true,
    callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [safeAddress] }),
  };
}
function decodeSpoke(name: SpokeFunction, data: `0x${string}`) {
  return decodeFunctionResult({ abi: spokeAbi, functionName: name, data } as never);
}

async function rpcCall(chainId: number, scope: RpcScope, method: string, params: unknown[]): Promise<RpcCallResult> {
  let lastError = "No RPC URL configured";
  for (const url of rpcUrlsFor(chainId, scope)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      const body = (await response.json()) as RpcResponse;
      if (response.ok && body.result !== undefined && body.result !== null) return { ok: true, value: body.result };
      lastError = body.error?.message ?? `RPC HTTP ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return { ok: false, error: lastError };
}

function batchedRpcCall(chainId: number, scope: RpcScope, method: string, params: unknown[]): Promise<RpcCallResult> {
  const key = `${chainId}:${scope}`;
  let state = rpcBatchStates.get(key);
  if (!state) {
    state = { queue: [], running: false, nextDispatchAt: 0 };
    rpcBatchStates.set(key, state);
  }

  return new Promise((resolve) => {
    state.queue.push({ method, params, resolve });
    if (state.running) return;
    state.running = true;
    queueMicrotask(() => void drainRpcBatch(chainId, scope, state));
  });
}

async function drainRpcBatch(chainId: number, scope: RpcScope, state: RpcBatchState) {
  try {
    while (state.queue.length > 0) {
      const waitMs = state.nextDispatchAt - Date.now();
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      state.nextDispatchAt = Date.now() + RPC_BATCH_MIN_INTERVAL_MS;
      const calls = state.queue.splice(0, RPC_BATCH_SIZE);
      const results = await executeRpcBatch(chainId, scope, calls);
      for (let index = 0; index < calls.length; index += 1)
        calls[index].resolve(results[index] ?? { ok: false, error: "RPC batch omitted a result" });
    }
  } finally {
    state.running = false;
    if (state.queue.length > 0) {
      state.running = true;
      queueMicrotask(() => void drainRpcBatch(chainId, scope, state));
    }
  }
}

async function executeRpcBatch(chainId: number, scope: RpcScope, calls: PendingRpcCall[]): Promise<RpcCallResult[]> {
  const results: Array<RpcCallResult | undefined> = new Array(calls.length);
  const errors = new Array<string>(calls.length).fill("No RPC URL configured");
  let remaining = calls.map((_, index) => index);

  for (const url of rpcUrlsFor(chainId, scope)) {
    if (remaining.length === 0) break;
    const requests = remaining.map((index) => ({
      jsonrpc: "2.0" as const,
      id: index + 1,
      method: calls[index].method,
      params: calls[index].params,
    }));
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requests),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      const body = (await response.json()) as RpcResponse[] | RpcResponse;
      if (!response.ok || !Array.isArray(body)) {
        const message = Array.isArray(body) ? undefined : body.error?.message;
        for (const index of remaining) errors[index] = message ?? `RPC HTTP ${response.status}`;
        continue;
      }
      const byId = new Map(body.map((item) => [Number(item.id), item]));
      const unresolved: number[] = [];
      for (const index of remaining) {
        const item = byId.get(index + 1);
        if (item?.result !== undefined && item.result !== null) results[index] = { ok: true, value: item.result };
        else {
          errors[index] = item?.error?.message ?? "RPC batch omitted a result";
          unresolved.push(index);
        }
      }
      remaining = unresolved;
    } catch (error) {
      for (const index of remaining) errors[index] = errorMessage(error);
    }
  }

  return results.map((result, index) => result ?? { ok: false, error: errors[index] });
}

function withPriceReference(
  result: EffectValue,
  blockNumber: bigint,
  blockHash: string,
  blockTimestamp: bigint,
): EffectValue {
  if (result.status !== "resolved") return result;
  try {
    const value = JSON.parse(result.valueJson) as Record<string, unknown>;
    return resolved({
      ...value,
      sourceBlockNumber: blockNumber.toString(),
      sourceBlockHash: blockHash.toLowerCase(),
      sourceTimestampSeconds: blockTimestamp.toString(),
    });
  } catch {
    return unavailable("PriceProvider returned an invalid cached payload");
  }
}

/** Archive reads never fall back to public/latest endpoints. */
export function rpcUrlsFor(chainId: number, scope: RpcScope = "current"): string[] {
  const urls =
    scope === "archive"
      ? chainId === CHAIN_IDS.optimism
        ? [
            process.env.OPTIMISM_ARCHIVE_RPC_URL,
            process.env.OPTIMISM_ARCHIVE_RPC_FALLBACK_URL,
            "https://optimism.rpc.sentio.xyz",
            "https://mainnet.optimism.io",
            "https://rpc-optimism.blockmachine.io",
          ]
        : chainId === CHAIN_IDS.scroll
          ? [
              process.env.SCROLL_ARCHIVE_RPC_URL,
              process.env.SCROLL_ARCHIVE_RPC_FALLBACK_URL,
              "https://scroll.rpc.sentio.xyz",
              "https://scroll.api.pocket.network",
              "https://scroll-rpc.publicnode.com",
              "https://rpc-scroll.blockmachine.io",
            ]
          : []
      : chainId === CHAIN_IDS.optimism
        ? [process.env.OPTIMISM_RPC_URL ?? "https://optimism-rpc.publicnode.com", process.env.OPTIMISM_RPC_FALLBACK_URL]
        : chainId === CHAIN_IDS.scroll
          ? [process.env.SCROLL_RPC_URL ?? "https://scroll-rpc.publicnode.com", process.env.SCROLL_RPC_FALLBACK_URL]
          : [];
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

/** Ether.fi deploys the same PriceProvider address on both Cash chains. */
export function priceProviderFor(chainId: number): Address | null {
  return chainId === CHAIN_IDS.optimism || chainId === CHAIN_IDS.scroll ? PRICE_PROVIDER_ADDRESS : null;
}

export function priceProviderDeploymentFor(chainId: number): { blockNumber: bigint; timestampSeconds: bigint } | null {
  return PRICE_PROVIDER_DEPLOYMENTS[chainId as keyof typeof PRICE_PROVIDER_DEPLOYMENTS] ?? null;
}

export function priceProviderAvailableAtBlock(chainId: number, blockNumber: bigint): boolean {
  const deployment = priceProviderDeploymentFor(chainId);
  return deployment !== null && blockNumber >= deployment.blockNumber;
}

export function exactBlockTag(blockNumber: bigint): `0x${string}` {
  return blockTag(blockNumber);
}

export function cacheSuccessfulResult(context: { cache: boolean }, result: EffectValue): EffectValue {
  if (result.status !== "resolved") context.cache = false;
  return result;
}

function decodeReservePlan(value: string): Reserve[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((reserve) => {
      if (!reserve || typeof reserve !== "object") throw new Error("Invalid reserve");
      const { reserveId, tokenAddress } = reserve as { reserveId?: unknown; tokenAddress?: unknown };
      if (
        typeof reserveId !== "string" ||
        !/^\d+$/.test(reserveId) ||
        (tokenAddress !== null && (typeof tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)))
      )
        throw new Error("Invalid reserve");
      return { reserveId: BigInt(reserveId), tokenAddress: tokenAddress?.toLowerCase() as Address | null };
    });
  } catch {
    return null;
  }
}
function parseHeader(value: unknown, expectedNumber: `0x${string}`): string | null {
  if (!value || typeof value !== "object") return null;
  const header = value as { number?: unknown; hash?: unknown };
  return header.number === expectedNumber && typeof header.hash === "string" ? header.hash : null;
}
function parseBlockNumber(value: string): bigint | null {
  try {
    return /^\d+$/.test(value) ? BigInt(value) : null;
  } catch {
    return null;
  }
}
function parseTimestampSeconds(value: string): bigint | null {
  try {
    return /^\d+$/.test(value) ? BigInt(value) : null;
  } catch {
    return null;
  }
}
function blockTag(blockNumber: bigint): `0x${string}` {
  return `0x${blockNumber.toString(16)}`;
}
function exactBlockReference(blockHash: string): RpcBlockReference {
  return { blockHash: blockHash.toLowerCase() as `0x${string}`, requireCanonical: true };
}
function isQuarterHourBucket(value: string) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() % 900_000 === 0;
}
function isTimestampInBucket(bucketStart: string, timestampSeconds: bigint): boolean {
  const start = Date.parse(bucketStart);
  if (!isQuarterHourBucket(bucketStart) || Number.isNaN(start)) return false;
  const startSeconds = BigInt(Math.floor(start / 1000));
  return timestampSeconds >= startSeconds && timestampSeconds < startSeconds + 900n;
}
function isBlockHash(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
function resolved(value: unknown): EffectValue {
  return { status: "resolved", valueJson: JSON.stringify(value), error: null };
}
function partial(value: unknown): EffectValue {
  return { status: "partial", valueJson: JSON.stringify(value), error: null };
}
function unavailable(error: string): EffectValue {
  return { status: "unavailable", valueJson: "null", error };
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
