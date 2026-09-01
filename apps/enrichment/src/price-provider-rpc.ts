import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

export const PRICE_PROVIDER_ADDRESS = "0x44dd2372fe7b97c4b4d6a7d4decf72466485bacb";
export const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";
export const PRICE_PROVIDER_DECIMALS = 6;

const priceProviderAbi = parseAbi(["function price(address token) view returns (uint256)"]);
const multicall3Abi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
]);

export type HistoricalPriceCall = {
  chainId: number;
  tokenAddress: `0x${string}`;
  blockNumber: bigint;
};

export type HistoricalPriceResult = HistoricalPriceCall & {
  priceUsdE6: bigint | null;
  error: string | null;
};

type JsonRpcResponse = { id: number; result?: string; error?: { code: number; message: string } };
type Fetcher = typeof fetch;

export const blockTag = (blockNumber: bigint) => `0x${blockNumber.toString(16)}` as const;
export const priceUsdE6ToE18 = (price: bigint) => price * 10n ** 12n;
export const tokenAmountUsdE6 = (amountRaw: bigint, tokenDecimals: number, priceUsdE6: bigint) => {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255)
    throw new Error("token decimals must be an integer between 0 and 255");
  return (amountRaw * priceUsdE6) / 10n ** BigInt(tokenDecimals);
};

export function encodePriceCall(tokenAddress: `0x${string}`) {
  return encodeFunctionData({ abi: priceProviderAbi, functionName: "price", args: [tokenAddress] });
}

function decodePriceResult(data: string): bigint {
  const value = decodeFunctionResult({
    abi: priceProviderAbi,
    functionName: "price",
    data: data as `0x${string}`,
  });
  if (value <= 0n) throw new Error("PriceProvider returned a zero price");
  return value;
}

/**
 * Calls PriceProvider at exact historical block tags. Tokens sharing a block are
 * packed into Multicall3; calls for different blocks are sent as one JSON-RPC batch.
 */
export async function fetchHistoricalPriceProviderPrices(options: {
  rpcUrl: string;
  calls: HistoricalPriceCall[];
  providerAddress?: `0x${string}`;
  multicallAddress?: `0x${string}`;
  fetcher?: Fetcher;
  maxRpcBatchSize?: number;
}): Promise<HistoricalPriceResult[]> {
  const providerAddress = options.providerAddress ?? PRICE_PROVIDER_ADDRESS;
  const multicallAddress = options.multicallAddress ?? MULTICALL3_ADDRESS;
  const fetcher = options.fetcher ?? fetch;
  const unique = new Map<string, HistoricalPriceCall>();
  for (const call of options.calls)
    unique.set(`${call.chainId}:${call.blockNumber}:${call.tokenAddress.toLowerCase()}`, call);

  const groups = new Map<string, HistoricalPriceCall[]>();
  for (const call of unique.values()) {
    const key = `${call.chainId}:${call.blockNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  const grouped = [...groups.values()];
  const requests = grouped.map((calls, index) => {
    const data =
      calls.length === 1
        ? encodePriceCall(calls[0].tokenAddress)
        : encodeFunctionData({
            abi: multicall3Abi,
            functionName: "aggregate3",
            args: [
              calls.map((call) => ({
                target: providerAddress,
                allowFailure: true,
                callData: encodePriceCall(call.tokenAddress),
              })),
            ],
          });
    return {
      jsonrpc: "2.0" as const,
      id: index + 1,
      method: "eth_call",
      params: [{ to: calls.length === 1 ? providerAddress : multicallAddress, data }, blockTag(calls[0].blockNumber)],
    };
  });
  if (!requests.length) return [];
  const maxRpcBatchSize = options.maxRpcBatchSize ?? 20;
  if (!Number.isInteger(maxRpcBatchSize) || maxRpcBatchSize < 1)
    throw new Error("maxRpcBatchSize must be a positive integer");
  const byId = new Map<number, JsonRpcResponse>();
  for (let offset = 0; offset < requests.length; offset += maxRpcBatchSize) {
    const rpcBatch = requests.slice(offset, offset + maxRpcBatchSize);
    for (const item of await postRpcBatch(options.rpcUrl, rpcBatch, fetcher)) byId.set(item.id, item);
  }
  const results: HistoricalPriceResult[] = [];
  for (let index = 0; index < grouped.length; index += 1) {
    const calls = grouped[index];
    const item = byId.get(index + 1);
    if (!item?.result) {
      const error = item?.error?.message ?? "RPC response omitted a result";
      results.push(...calls.map((call) => ({ ...call, priceUsdE6: null, error })));
      continue;
    }
    if (calls.length === 1) {
      try {
        results.push({ ...calls[0], priceUsdE6: decodePriceResult(item.result), error: null });
      } catch (error) {
        results.push({ ...calls[0], priceUsdE6: null, error: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    try {
      const decoded = decodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        data: item.result as `0x${string}`,
      });
      for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
        const result = decoded[callIndex];
        if (!result?.success) {
          results.push({ ...calls[callIndex], priceUsdE6: null, error: "PriceProvider call reverted" });
          continue;
        }
        try {
          results.push({ ...calls[callIndex], priceUsdE6: decodePriceResult(result.returnData), error: null });
        } catch (error) {
          results.push({
            ...calls[callIndex],
            priceUsdE6: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push(...calls.map((call) => ({ ...call, priceUsdE6: null, error: message })));
    }
  }
  return options.calls.map((call) => {
    const result = results.find(
      (row) =>
        row.chainId === call.chainId &&
        row.blockNumber === call.blockNumber &&
        row.tokenAddress.toLowerCase() === call.tokenAddress.toLowerCase(),
    );
    return result ?? { ...call, priceUsdE6: null, error: "Price result was not mapped" };
  });
}

async function postRpcBatch(
  rpcUrl: string,
  requests: Array<{ jsonrpc: "2.0"; id: number; method: string; params: unknown[] }>,
  fetcher: Fetcher,
): Promise<JsonRpcResponse[]> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requests),
  });
  if ((response.status === 413 || response.status === 429 || response.status >= 500) && requests.length > 1) {
    const middle = Math.ceil(requests.length / 2);
    return [
      ...(await postRpcBatch(rpcUrl, requests.slice(0, middle), fetcher)),
      ...(await postRpcBatch(rpcUrl, requests.slice(middle), fetcher)),
    ];
  }
  if (response.status === 413 || response.status === 429 || response.status >= 500)
    return requests.map((request) => ({
      id: request.id,
      error: { code: response.status, message: `Price RPC HTTP ${response.status}` },
    }));
  if (!response.ok) throw new Error(`Price RPC HTTP ${response.status}`);
  const payload = (await response.json()) as JsonRpcResponse[] | JsonRpcResponse;
  return Array.isArray(payload) ? payload : [payload];
}

export async function rpcBlockNumber(rpcUrl: string, fetcher: Fetcher = fetch): Promise<bigint> {
  const value = await singleRpc<string>(rpcUrl, "eth_blockNumber", [], fetcher);
  return BigInt(value);
}

export async function rpcBlockTimestamp(rpcUrl: string, number: bigint, fetcher: Fetcher = fetch): Promise<string> {
  const block = await singleRpc<{ timestamp: string }>(
    rpcUrl,
    "eth_getBlockByNumber",
    [blockTag(number), false],
    fetcher,
  );
  return new Date(Number(BigInt(block.timestamp)) * 1_000).toISOString();
}

async function singleRpc<T>(rpcUrl: string, method: string, params: unknown[], fetcher: Fetcher): Promise<T> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Price RPC HTTP ${response.status}`);
  const payload = (await response.json()) as { result?: T; error?: { message: string } };
  if (payload.error || payload.result == null)
    throw new Error(payload.error?.message ?? `${method} returned no result`);
  return payload.result;
}
