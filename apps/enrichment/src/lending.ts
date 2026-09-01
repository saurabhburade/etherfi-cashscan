import { canonicalEventId, normalizeAddress, tokenId } from "./ids.js";
import type { LendingReserveState, LendingSourceEvent, LendingSourceEventLeg, SourcePage } from "./types.js";

export type LendingEventProjection = {
  id: string;
  /** Remote Envio ID; the persisted event ID is the canonical chain:tx:log key. */
  remoteSourceEventId: string;
  chainId: number;
  transactionHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string;
  sourceKind: LendingSourceEvent["sourceKind"];
  eventType: LendingSourceEvent["eventType"];
  /** Chain-scoped account row, retained for legacy/account-token joins. */
  accountId: string;
  /** Cross-chain identity row, keyed solely by normalized Safe address. */
  accountIdentityId: string;
  marketAddress: string;
  sourceAddress: string;
  reserveId: bigint | null;
  metadata: string;
};
export type LendingLegProjection = {
  id: string;
  lendingEventId: string;
  tokenId: string | null;
  reserveId: bigint | null;
  legType: string;
  legIndex: number;
  direction: LendingSourceEventLeg["direction"];
  amount: bigint | null;
  shares: bigint | null;
  suppliedSharesDelta: bigint | null;
  drawnSharesDelta: bigint | null;
  premiumSharesDelta: bigint | null;
  premiumOffsetRayDelta: bigint | null;
};
export type EconomicActionProjection = {
  id: string;
  chainId: number;
  accountId: string;
  accountIdentityId: string;
  transactionHash: string;
  blockNumber: string;
  timestamp: string;
  actionType: LendingSourceEvent["eventType"];
  semanticKey: string;
};
export type LendingProjection = {
  events: LendingEventProjection[];
  legs: LendingLegProjection[];
  actions: EconomicActionProjection[];
  actionSources: Array<{
    economicActionId: string;
    lendingEventId: string;
    sourceKind: LendingSourceEvent["sourceKind"];
  }>;
  reserves: LendingReserveState[];
};

const ACTION_PRIORITY: Record<LendingSourceEvent["eventType"], number> = {
  liquidation: 0,
  deficit: 1,
  borrow: 2,
  repay: 3,
  withdraw: 4,
  supply: 5,
  collateral_enable: 6,
  collateral_disable: 7,
  reserve_registered: 8,
  reserve_deregistered: 9,
  position_manager_update: 10,
  spend: 11,
  cashback: 12,
};

/** A transaction/account is one economic action even when Cash, Gateway and
 * Spoke all emit corroborating logs.  Source logs remain fully queryable. */
export function projectLending(
  page: Pick<SourcePage, "lendingSourceEvents" | "lendingSourceEventLegs" | "lendingReserveStates">,
): LendingProjection {
  const sourceEvents = page.lendingSourceEvents ?? [];
  const legsByEvent = new Map<string, LendingSourceEventLeg[]>();
  for (const leg of page.lendingSourceEventLegs ?? [])
    legsByEvent.set(leg.sourceEventId, [...(legsByEvent.get(leg.sourceEventId) ?? []), leg]);
  const events = sourceEvents.flatMap<LendingEventProjection>((source) => {
    if (!source.safeAddress) return [];
    const safeAddress = normalizeAddress(source.safeAddress);
    return [
      {
        id: canonicalEventId(source.chainId, source.transactionHash, source.logIndex),
        remoteSourceEventId: source.id,
        chainId: source.chainId,
        transactionHash: source.transactionHash.toLowerCase(),
        logIndex: source.logIndex,
        blockNumber: source.blockNumber,
        timestamp: source.timestamp,
        sourceKind: source.sourceKind,
        eventType: source.eventType,
        accountId: `${source.chainId}:${safeAddress}`,
        accountIdentityId: safeAddress,
        marketAddress: normalizeAddress(
          source.marketAddress ??
            source.spokeAddress ??
            source.sourceAddress ??
            "0x0000000000000000000000000000000000000000",
        ),
        sourceAddress: normalizeAddress(
          source.sourceAddress ??
            source.marketAddress ??
            source.spokeAddress ??
            "0x0000000000000000000000000000000000000000",
        ),
        reserveId: source.reserveId == null ? null : BigInt(source.reserveId),
        metadata: source.metadata,
      },
    ];
  });
  const rawSourceById = new Map(sourceEvents.map((source) => [source.id, source]));
  const bySourceId = new Map(events.map((event) => [event.remoteSourceEventId, event]));
  const legs = (page.lendingSourceEventLegs ?? []).flatMap<LendingLegProjection>((leg) => {
    const event = bySourceId.get(leg.sourceEventId);
    if (!event) return [];
    return [
      {
        id: `lending-leg:${leg.id}`,
        lendingEventId: event.id,
        tokenId: leg.tokenAddress ? tokenId(event.chainId, leg.tokenAddress) : null,
        reserveId: leg.reserveId == null ? null : BigInt(leg.reserveId),
        legType: leg.legType,
        legIndex: leg.legIndex,
        direction: leg.direction,
        amount: leg.amount == null ? null : BigInt(leg.amount),
        shares: leg.shares == null ? null : BigInt(leg.shares),
        suppliedSharesDelta: leg.suppliedSharesDelta == null ? null : BigInt(leg.suppliedSharesDelta),
        drawnSharesDelta: leg.drawnSharesDelta == null ? null : BigInt(leg.drawnSharesDelta),
        premiumSharesDelta: leg.premiumSharesDelta == null ? null : BigInt(leg.premiumSharesDelta),
        premiumOffsetRayDelta: leg.premiumOffsetRayDelta == null ? null : BigInt(leg.premiumOffsetRayDelta),
      },
    ];
  });
  const grouped = new Map<string, LendingEventProjection[]>();
  for (const event of events) {
    const source = rawSourceById.get(event.remoteSourceEventId);
    if (!source) continue;
    // A single source log can have reserve/token legs.  Such legs are part of
    // its operation fingerprint, not separate deposits/debts.  Distinct
    // reserve/token operations in the same transaction remain separate.
    // Token is stable across Gateway/Spoke representations. Reserve numbers are
    // only meaningful within a market, so use them solely when token mapping is
    // absent.
    const legKeys = (legsByEvent.get(source.id) ?? [])
      .sort((a, b) => a.legIndex - b.legIndex)
      .map((leg) =>
        leg.tokenAddress
          ? `token:${leg.tokenAddress.toLowerCase()}`
          : `reserve:${event.marketAddress}:${leg.reserveId ?? event.reserveId?.toString() ?? "-"}`,
      );
    const fallback = `reserve:${event.marketAddress}:${event.reserveId?.toString() ?? "-"}`;
    // A lending source log is immutable provenance for exactly one action.
    // Liquidation joins all ordered debt/collateral/fee legs in one fingerprint;
    // ordinary operations select their normalized asset dimension once.
    const dimension =
      event.eventType === "liquidation"
        ? `liquidation:${(legKeys.length ? legKeys : [fallback]).join("|")}`
        : (legKeys[0] ?? fallback);
    const key = `${event.chainId}:${event.transactionHash}:${event.accountIdentityId}:${event.eventType}:${dimension}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  const actions: EconomicActionProjection[] = [];
  const actionSources: LendingProjection["actionSources"] = [];
  for (const [semanticKey, group] of grouped) {
    // No priority selection: group membership is already one semantic action.
    // Ordering only selects stable provenance fields for its deterministic ID.
    const sorted = [...group].sort(
      (a, b) => a.logIndex - b.logIndex || ACTION_PRIORITY[a.eventType] - ACTION_PRIORITY[b.eventType],
    );
    const first = sorted[0];
    const id = `lending-action:${semanticKey}`;
    actions.push({
      id,
      chainId: first.chainId,
      accountId: first.accountId,
      accountIdentityId: first.accountIdentityId,
      transactionHash: first.transactionHash,
      blockNumber: first.blockNumber,
      timestamp: first.timestamp,
      actionType: first.eventType,
      semanticKey,
    });
    for (const source of sorted)
      actionSources.push({ economicActionId: id, lendingEventId: source.id, sourceKind: source.sourceKind });
  }
  return { events, legs, actions, actionSources, reserves: page.lendingReserveStates ?? [] };
}

export const lendingRiskChanging = (type: LendingSourceEvent["eventType"]) =>
  type === "borrow" || type === "repay" || type === "withdraw" || type === "liquidation";
