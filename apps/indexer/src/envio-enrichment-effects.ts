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
const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11" as const;

const priceProviderAbi = parseAbi(["function price(address token) view returns (uint256)"]);
const PRICE_PROVIDER_DECIMALS = 6;

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
type RpcResponse = { result?: unknown; error?: { message?: string } };
export type EffectValue = { status: "resolved" | "partial" | "unavailable"; valueJson: string; error: string | null };
type RpcScope = "current" | "archive";

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
    name: "cash_current_token_price_v1",
    // Cache key: (chain, tokenAddress, fifteenMinuteBucket, anchorBlock).
    // The scheduler supplies an exact block, so replay never calls "latest".
    input: { tokenAddress: S.address, bucketStart: S.string, blockNumber: S.string, blockHash: S.string },
    output: { status: S.string, valueJson: S.string, error: S.nullable(S.string) },
    cache: true,
    crossChain: false,
    rateLimit: { calls: 10, per: "second" },
  },
  async ({ input, context }) => {
    const blockNumber = parseBlockNumber(input.blockNumber);
    const result =
      !isQuarterHourBucket(input.bucketStart) || blockNumber === null
        ? unavailable("Invalid 15-minute price bucket or anchor block")
        : // The anchor may be historical during a replay, so even a current
          // price refresh needs an archive-capable endpoint for its exact tag.
          await readPrice(context.chain.id, input.tokenAddress as Address, blockTag(blockNumber), "archive");
    return cacheSuccessfulResult(context, result);
  },
);

export const crossChainTokenPriceEffect = createEffect(
  {
    name: "cash_cross_chain_token_price_v1",
    // Cache key: (reference chain, verified peer token, UTC 15-minute bucket).
    // The reference block is resolved from this timestamp; a Scroll block
    // number is never reused on Optimism (or vice versa).
    input: { referenceChainId: S.string, referenceTokenAddress: S.address, bucketStart: S.string },
    output: { status: S.string, valueJson: S.string, error: S.nullable(S.string) },
    cache: true,
    crossChain: true,
    rateLimit: { calls: 2, per: "second" },
  },
  async ({ input, context }) => {
    const referenceChainId = Number(input.referenceChainId);
    const targetTimestamp = Date.parse(input.bucketStart);
    if (
      !Number.isSafeInteger(referenceChainId) ||
      !priceProviderFor(referenceChainId) ||
      !isQuarterHourBucket(input.bucketStart) ||
      Number.isNaN(targetTimestamp)
    )
      return cacheSuccessfulResult(context, unavailable("Invalid cross-chain price reference"));

    const referenceBlock = await blockAtOrBeforeTimestamp(referenceChainId, BigInt(Math.floor(targetTimestamp / 1000)));
    if (!referenceBlock)
      return cacheSuccessfulResult(context, unavailable("Reference-chain block unavailable for price timestamp"));

    const price = await readPrice(
      referenceChainId,
      input.referenceTokenAddress as Address,
      blockTag(referenceBlock.number),
      "archive",
    );
    if (price.status !== "resolved") return cacheSuccessfulResult(context, price);
    try {
      const value = JSON.parse(price.valueJson) as Record<string, unknown>;
      return cacheSuccessfulResult(
        context,
        resolved({
          ...value,
          referenceChainId,
          referenceTokenAddress: input.referenceTokenAddress.toLowerCase(),
          referenceBlockNumber: referenceBlock.number.toString(),
          referenceBlockTimestamp: referenceBlock.timestamp.toString(),
        }),
      );
    } catch (error) {
      return cacheSuccessfulResult(context, unavailable(errorMessage(error)));
    }
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
  at: `0x${string}`,
  scope: RpcScope,
): Promise<EffectValue> {
  const provider = priceProviderFor(chainId);
  if (!provider) return unavailable("No verified PriceProvider for this chain; use event-emitted prices");
  const data = encodeFunctionData({ abi: priceProviderAbi, functionName: "price", args: [tokenAddress] });
  const rpc = await rpcCall(chainId, scope, "eth_call", [{ to: provider, data }, at]);
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
      blockTag: at,
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

async function rpcCall(
  chainId: number,
  scope: RpcScope,
  method: string,
  params: unknown[],
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let lastError = "No RPC URL configured";
  for (const url of rpcUrlsFor(chainId, scope)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
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

async function blockAtOrBeforeTimestamp(
  chainId: number,
  targetTimestamp: bigint,
): Promise<{ number: bigint; timestamp: bigint } | null> {
  const latest = await rpcCall(chainId, "archive", "eth_blockNumber", []);
  if (!latest.ok || typeof latest.value !== "string") return null;
  let high: bigint;
  try {
    high = BigInt(latest.value);
  } catch {
    return null;
  }
  let low = 0n;
  let best: { number: bigint; timestamp: bigint } | null = null;
  while (low <= high) {
    const middle = (low + high) / 2n;
    const response = await rpcCall(chainId, "archive", "eth_getBlockByNumber", [blockTag(middle), false]);
    if (!response.ok || !response.value || typeof response.value !== "object") return null;
    const block = response.value as { number?: unknown; timestamp?: unknown };
    if (typeof block.number !== "string" || typeof block.timestamp !== "string") return null;
    let number: bigint;
    let timestamp: bigint;
    try {
      number = BigInt(block.number);
      timestamp = BigInt(block.timestamp);
    } catch {
      return null;
    }
    if (timestamp <= targetTimestamp) {
      best = { number, timestamp };
      low = middle + 1n;
    } else {
      if (middle === 0n) break;
      high = middle - 1n;
    }
  }
  return best;
}

/** Archive reads never fall back to public/latest endpoints. */
export function rpcUrlsFor(chainId: number, scope: RpcScope = "current"): string[] {
  const urls =
    scope === "archive"
      ? chainId === CHAIN_IDS.optimism
        ? [
            process.env.OPTIMISM_ARCHIVE_RPC_URL,
            process.env.OPTIMISM_ARCHIVE_RPC_FALLBACK_URL,
            "https://optimism.drpc.org",
            "https://optimism-rpc.publicnode.com",
          ]
        : chainId === CHAIN_IDS.scroll
          ? [
              process.env.SCROLL_ARCHIVE_RPC_URL,
              process.env.SCROLL_ARCHIVE_RPC_FALLBACK_URL,
              "https://scroll.drpc.org",
              "https://scroll-rpc.publicnode.com",
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
function blockTag(blockNumber: bigint): `0x${string}` {
  return `0x${blockNumber.toString(16)}`;
}
function isQuarterHourBucket(value: string) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() % 900_000 === 0;
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
