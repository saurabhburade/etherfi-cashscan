import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { lendingRiskChanging } from "./lending.js";
import { blockTag, MULTICALL3_ADDRESS } from "./price-provider-rpc.js";
import type { LendingSourceEvent } from "./types.js";

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
export type SnapshotReserve = { reserveId: bigint; tokenAddress: `0x${string}` | null };
export type SnapshotTrigger = "normal" | "risk" | "historical";
export type LendingSnapshotRequest = {
  chainId: number;
  safeAddress: `0x${string}`;
  spokeAddress: `0x${string}`;
  reserves: SnapshotReserve[];
  blockNumber: bigint;
  trigger: SnapshotTrigger;
};
export type LendingStateSnapshot = LendingSnapshotRequest & {
  blockHash: string | null;
  walletBalance: bigint | null;
  suppliedBalance: bigint | null;
  grossAssets: bigint | null;
  protocolDebt: bigint | null;
  eventLedgerOutstandingDebt: bigint | null;
  netWorth: bigint | null;
  riskPremiumRay: bigint | null;
  avgCollateralFactorE18: bigint | null;
  healthFactorE18: bigint | null;
  totalCollateralValueRaw: bigint | null;
  totalDebtValueRayRaw: bigint | null;
  activeCollateralCount: bigint | null;
  borrowCount: bigint | null;
  positions: Map<
    bigint,
    {
      walletBalance: bigint | null;
      suppliedBalance: bigint | null;
      drawnShares: bigint | null;
      premiumShares: bigint | null;
      premiumOffsetRay: bigint | null;
      suppliedShares: bigint | null;
      totalDebt: bigint | null;
    }
  >;
  reserveStatus: Map<bigint, { enabledAsCollateral: boolean | null; borrowed: boolean | null }>;
  archiveFailure: string | null;
};
export const FIFTEEN_MINUTES_MS = 900_000;
export const finalizedCheckpoint = (head: bigint, confirmations: bigint) =>
  head > confirmations ? head - confirmations : 0n;
export const activityBucket = (time: string) =>
  new Date(Math.floor(new Date(time).getTime() / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS).toISOString();
export const shouldRefreshSnapshot = (last: string | null, trigger: SnapshotTrigger, now = new Date()) =>
  trigger === "risk" || last == null || now.getTime() - new Date(last).getTime() >= FIFTEEN_MINUTES_MS;
export const calculateNetWorth = (wallet: bigint | null, gross: bigint | null, debt: bigint | null) =>
  wallet == null || gross == null || debt == null ? null : wallet + gross - debt;

export function queueFinalizedSnapshots(
  events: LendingSourceEvent[],
  last: ReadonlyMap<string, string | null>,
  finalized: ReadonlyMap<number, bigint>,
  now = new Date(),
  reserveStates: import("./types.js").LendingReserveState[] = [],
): LendingSnapshotRequest[] {
  const grouped = new Map<
    string,
    {
      event: LendingSourceEvent;
      safeAddress: `0x${string}`;
      spokeAddress: `0x${string}`;
      reserves: Map<bigint, SnapshotReserve>;
      trigger: SnapshotTrigger;
    }
  >();
  for (const event of events) {
    if (!event.safeAddress || !event.spokeAddress || (finalized.get(event.chainId) ?? -1n) < BigInt(event.blockNumber))
      continue;
    const safeAddress = event.safeAddress.toLowerCase() as `0x${string}`;
    const spokeAddress = event.spokeAddress.toLowerCase() as `0x${string}`;
    const key = `${event.chainId}:${safeAddress}:${event.blockNumber}`;
    const current = grouped.get(key) ?? {
      event,
      safeAddress,
      spokeAddress,
      reserves: new Map(),
      trigger: "normal" as SnapshotTrigger,
    };
    if (lendingRiskChanging(event.eventType)) current.trigger = "risk";
    for (const id of [event.reserveId, event.collateralReserveId, event.debtReserveId])
      if (id != null) {
        const state = reserveStates.find(
          (s) => s.chainId === event.chainId && s.reserveId === id && s.spokeAddress?.toLowerCase() === spokeAddress,
        );
        current.reserves.set(BigInt(id), {
          reserveId: BigInt(id),
          tokenAddress: (state?.tokenAddress?.toLowerCase() as `0x${string}`) ?? null,
        });
      }
    grouped.set(key, current);
  }
  return [...grouped.values()].flatMap(({ event, safeAddress, spokeAddress, reserves, trigger }) => {
    if (!shouldRefreshSnapshot(last.get(`${event.chainId}:${safeAddress}`) ?? null, trigger, now)) return [];
    return [
      {
        chainId: event.chainId,
        safeAddress,
        spokeAddress,
        reserves: [...reserves.values()],
        blockNumber: BigInt(event.blockNumber),
        trigger,
      },
    ];
  });
}

export async function fetchLendingStateSnapshots(options: {
  rpcUrl: string;
  requests: LendingSnapshotRequest[];
  fetcher?: typeof fetch;
  multicallAddress?: `0x${string}`;
}): Promise<LendingStateSnapshot[]> {
  const fetcher = options.fetcher ?? fetch;
  const multicall = options.multicallAddress ?? (MULTICALL3_ADDRESS as `0x${string}`);
  const result: LendingStateSnapshot[] = [];
  const headers = new Map<string, Promise<string | null>>();
  for (const request of options.requests) {
    let blockHash: string | null = null;
    try {
      const headerKey = `${request.chainId}:${request.blockNumber}`;
      blockHash = await (headers.get(headerKey) ??
        (() => {
          const value = verifiedBlockHash(options.rpcUrl, request.blockNumber, fetcher);
          headers.set(headerKey, value);
          return value;
        })());
      if (!blockHash) throw new Error("Exact block header unavailable");
      const calls = [
        call(request.spokeAddress, "getUserAccountData", [request.safeAddress]),
        ...request.reserves.flatMap((r) => [
          call(request.spokeAddress, "getUserPosition", [r.reserveId, request.safeAddress]),
          call(request.spokeAddress, "getUserSuppliedAssets", [r.reserveId, request.safeAddress]),
          call(request.spokeAddress, "getUserTotalDebt", [r.reserveId, request.safeAddress]),
          call(request.spokeAddress, "getUserReserveStatus", [r.reserveId, request.safeAddress]),
          ...(r.tokenAddress ? [erc20(r.tokenAddress, request.safeAddress)] : []),
        ]),
      ];
      const data = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [calls] });
      const response = await fetcher(options.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: multicall, data }, blockTag(request.blockNumber)],
        }),
      });
      const payload = (await response.json()) as { result?: `0x${string}`; error?: { message?: string } };
      if (!response.ok || !payload.result) throw new Error(payload.error?.message ?? `RPC HTTP ${response.status}`);
      const values = decodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", data: payload.result });
      const account = values[0]?.success
        ? (decode("getUserAccountData", values[0].returnData) as readonly bigint[])
        : null;
      const positions = new Map<bigint, LendingStateSnapshot["positions"] extends Map<bigint, infer P> ? P : never>();
      const status = new Map<bigint, { enabledAsCollateral: boolean | null; borrowed: boolean | null }>();
      let offset = 1;
      for (const r of request.reserves) {
        const position = values[offset++],
          supplied = values[offset++],
          debt = values[offset++],
          reserveStatus = values[offset++],
          balance = r.tokenAddress ? values[offset++] : undefined;
        const p = position?.success
          ? (decode("getUserPosition", position.returnData) as readonly [bigint, bigint, bigint, bigint, bigint])
          : null;
        positions.set(r.reserveId, {
          walletBalance: balance?.success
            ? (decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: balance.returnData }) as bigint)
            : null,
          suppliedBalance: supplied?.success ? (decode("getUserSuppliedAssets", supplied.returnData) as bigint) : null,
          drawnShares: p?.[0] ?? null,
          premiumShares: p?.[1] ?? null,
          premiumOffsetRay: p?.[2] ?? null,
          suppliedShares: p?.[3] ?? null,
          totalDebt: debt?.success ? (decode("getUserTotalDebt", debt.returnData) as bigint) : null,
        });
        const s = reserveStatus?.success
          ? (decode("getUserReserveStatus", reserveStatus.returnData) as readonly [boolean, boolean])
          : null;
        status.set(r.reserveId, { enabledAsCollateral: s?.[0] ?? null, borrowed: s?.[1] ?? null });
      }
      result.push({
        ...request,
        blockHash,
        walletBalance: null,
        suppliedBalance: null,
        grossAssets: null,
        protocolDebt: null,
        eventLedgerOutstandingDebt: null,
        netWorth: null,
        riskPremiumRay: account?.[0] ?? null,
        avgCollateralFactorE18: account?.[1] ?? null,
        healthFactorE18: account?.[2] ?? null,
        totalCollateralValueRaw: account?.[3] ?? null,
        totalDebtValueRayRaw: account?.[4] ?? null,
        activeCollateralCount: account?.[5] ?? null,
        borrowCount: account?.[6] ?? null,
        positions,
        reserveStatus: status,
        archiveFailure: null,
      });
    } catch (error) {
      result.push({
        ...request,
        blockHash,
        walletBalance: null,
        suppliedBalance: null,
        grossAssets: null,
        protocolDebt: null,
        eventLedgerOutstandingDebt: null,
        netWorth: null,
        riskPremiumRay: null,
        avgCollateralFactorE18: null,
        healthFactorE18: null,
        totalCollateralValueRaw: null,
        totalDebtValueRayRaw: null,
        activeCollateralCount: null,
        borrowCount: null,
        positions: new Map(),
        reserveStatus: new Map(),
        archiveFailure: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
type Fn =
  | "getUserAccountData"
  | "getUserPosition"
  | "getUserSuppliedAssets"
  | "getUserTotalDebt"
  | "getUserReserveStatus";
const call = (target: `0x${string}`, functionName: Fn, args: readonly unknown[]) => ({
  target,
  allowFailure: true,
  callData: encodeFunctionData({ abi: spokeAbi, functionName, args: args as never }),
});
const erc20 = (target: `0x${string}`, safe: `0x${string}`) => ({
  target,
  allowFailure: true,
  callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [safe] }),
});
const decode = (functionName: Fn, data: `0x${string}`) =>
  decodeFunctionResult({ abi: spokeAbi, functionName, data } as never);
async function verifiedBlockHash(rpcUrl: string, block: bigint, fetcher: typeof fetch): Promise<string | null> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: [blockTag(block), false] }),
  });
  const body = (await response.json()) as { result?: { number?: string; hash?: string } };
  return response.ok && body.result?.number === blockTag(block) && body.result.hash ? body.result.hash : null;
}
