import { canonicalReservePlan, fifteenMinuteBucket } from "../envio-enrichment-effects.js";

export type StateChange = {
  chainId: number;
  safeAddress: string;
  marketId: string;
  spokeAddress: string;
  blockNumber: bigint;
  occurredAt: Date;
  riskChanging: boolean;
  reserves: readonly { reserveId: bigint | string; tokenAddress: string | null }[];
};
export type SnapshotPlan = {
  chainId: number;
  safeAddress: string;
  marketId: string;
  spokeAddress: string;
  blockNumber: string;
  reservePlan: string;
  trigger: "risk" | "activity";
};

/**
 * Event-driven planner for use by event handlers and optionally onBlock. It
 * only considers Safes present in `changes`: an idle chain causes no RPC and
 * it never scans every Safe. A risk event retains its exact block; ordinary
 * activity coalesces to the most recent event in its 15-minute bucket.
 */
export function planLendingSnapshots(
  changes: readonly StateChange[],
  priorBucketBySafeMarket: ReadonlyMap<string, string | null>,
): SnapshotPlan[] {
  const grouped = new Map<string, StateChange[]>();
  for (const change of changes) {
    const safeAddress = change.safeAddress.toLowerCase();
    const marketId = change.marketId.toLowerCase();
    const bucket = fifteenMinuteBucket(change.occurredAt);
    const discriminator = change.riskChanging ? `block:${change.blockNumber}` : `bucket:${bucket}`;
    const key = `${change.chainId}:${safeAddress}:${marketId}:${discriminator}`;
    grouped.set(key, [
      ...(grouped.get(key) ?? []),
      { ...change, safeAddress, marketId, spokeAddress: change.spokeAddress.toLowerCase() },
    ]);
  }
  const plans: SnapshotPlan[] = [];
  for (const changesForKey of grouped.values()) {
    const latest = [...changesForKey].sort((a, b) =>
      a.blockNumber < b.blockNumber ? 1 : a.blockNumber > b.blockNumber ? -1 : 0,
    )[0];
    const bucket = fifteenMinuteBucket(latest.occurredAt);
    const lookup = `${latest.chainId}:${latest.safeAddress}:${latest.marketId}`;
    if (!latest.riskChanging && priorBucketBySafeMarket.get(lookup) === bucket) continue;
    const reserves = new Map<string, { reserveId: bigint | string; tokenAddress: string | null }>();
    for (const change of changesForKey)
      for (const reserve of change.reserves) reserves.set(BigInt(reserve.reserveId).toString(), reserve);
    plans.push({
      chainId: latest.chainId,
      safeAddress: latest.safeAddress,
      marketId: latest.marketId,
      spokeAddress: latest.spokeAddress,
      blockNumber: latest.blockNumber.toString(),
      reservePlan: canonicalReservePlan([...reserves.values()]),
      trigger: latest.riskChanging ? "risk" : "activity",
    });
  }
  return plans.sort(
    (a, b) =>
      a.chainId - b.chainId ||
      a.safeAddress.localeCompare(b.safeAddress) ||
      Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)),
  );
}

export type SnapshotEffectResult = {
  status: "resolved" | "partial" | "unavailable";
  valueJson: string;
  error: string | null;
};
export function decodeSnapshotEffectResult(result: SnapshotEffectResult): {
  status: SnapshotEffectResult["status"];
  snapshot: Record<string, unknown> | null;
  error: string | null;
} {
  if (result.status === "unavailable")
    return { status: result.status, snapshot: null, error: result.error ?? "Snapshot unavailable" };
  try {
    const snapshot = JSON.parse(result.valueJson) as unknown;
    return snapshot && typeof snapshot === "object"
      ? { status: result.status, snapshot: snapshot as Record<string, unknown>, error: result.error }
      : { status: "unavailable", snapshot: null, error: "Snapshot payload is invalid" };
  } catch {
    return { status: "unavailable", snapshot: null, error: "Snapshot payload is invalid" };
  }
}

/** Parent connection after schema codegen: call context.effect(lendingStateSnapshotEffect, plan), then persist this decoded result into Lending*Snapshot entities. */
