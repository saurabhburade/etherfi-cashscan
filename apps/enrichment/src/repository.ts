import { normalizeAddress, tokenId } from "./ids.js";
import type { LendingProjection } from "./lending.js";
import type { LendingStateSnapshot } from "./lending-snapshots.js";
import type { CurrentPrice, PriceCandidate, PriceObservation } from "./pricing.js";
import type { SafeBalanceDto, ScannerEvent, ScannerEventTokenLeg, TokenMetadataDto } from "./types.js";

export type SqlPlan = { text: string; values: unknown[] };

export function formatUnits(value: bigint | null, decimals: number): string | null {
  if (value == null) return null;
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(decimals + 1, "0");
  return decimals ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : `${sign}${digits}`;
}

export const accountUpsertPlan = (chainId: number, address: string): SqlPlan => ({
  text: `INSERT INTO cash_explorer.account (id, chain_id, address)
    VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET updated_at=now()`,
  values: [`${chainId}:${normalizeAddress(address)}`, chainId, normalizeAddress(address)],
});

export const tokenUpsertPlan = (chainId: number, address: string): SqlPlan => ({
  text: `INSERT INTO cash_explorer.token (id, chain_id, address)
    VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET updated_at=now()`,
  values: [tokenId(chainId, address), chainId, normalizeAddress(address)],
});

export const tokenMetadataUpsertPlan = (token: TokenMetadataDto): SqlPlan => ({
  text: `INSERT INTO cash_explorer.token
    (id,chain_id,address,name,symbol,decimals,decimals_verified,metadata_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,symbol=EXCLUDED.symbol,
      decimals=EXCLUDED.decimals,decimals_verified=EXCLUDED.decimals_verified,
      metadata_status=EXCLUDED.metadata_status,updated_at=now()`,
  values: [
    tokenId(token.chainId, token.address),
    token.chainId,
    normalizeAddress(token.address),
    token.name,
    token.symbol,
    token.decimals,
    token.decimalsVerified,
    token.metadataStatus,
  ],
});

export function eventUpsertPlan(event: ScannerEvent): SqlPlan {
  const accountId = event.accountAddress ? `${event.chainId}:${normalizeAddress(event.accountAddress)}` : null;
  const duplicateOf = event.accountingRole === "duplicate" ? String(event.metadata.duplicateOf ?? "") || null : null;
  const contractAddress = typeof event.metadata.contractAddress === "string" ? event.metadata.contractAddress : null;
  return {
    text: `INSERT INTO cash_explorer.scanner_event
      (id,chain_id,transaction_hash,log_index,block_number,block_hash,timestamp,account_id,actor_address,
       event_type,mode,accounting_role,canonical_group_id,accounting_direction,accounting_kind,amount,
       amount_usd_raw,amount_usd,usd_decimals,usd_status,price_status,token_count,audit_duplicate_of_id,
       is_audit_duplicate,source_name,source_event_name,source_contract_address,source_entity_type,
       source_entity_id,source_provenance,source_payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb)
      ON CONFLICT (id) DO UPDATE SET block_hash=COALESCE(EXCLUDED.block_hash,cash_explorer.scanner_event.block_hash),
       account_id=EXCLUDED.account_id,actor_address=EXCLUDED.actor_address,event_type=EXCLUDED.event_type,
       mode=EXCLUDED.mode,accounting_role=EXCLUDED.accounting_role,accounting_direction=EXCLUDED.accounting_direction,
       accounting_kind=EXCLUDED.accounting_kind,amount=EXCLUDED.amount,amount_usd_raw=EXCLUDED.amount_usd_raw,
       amount_usd=EXCLUDED.amount_usd,usd_decimals=EXCLUDED.usd_decimals,usd_status=EXCLUDED.usd_status,
       token_count=EXCLUDED.token_count,source_contract_address=EXCLUDED.source_contract_address,
       source_provenance=EXCLUDED.source_provenance,source_payload=EXCLUDED.source_payload,updated_at=now()`,
    values: [
      event.id,
      event.chainId,
      event.transactionHash,
      event.logIndex,
      event.blockNumber,
      event.blockHash,
      event.timestamp,
      accountId,
      event.accountAddress,
      event.eventType,
      event.metadata.mode ?? null,
      event.accountingRole,
      duplicateOf,
      event.accountingDirection ?? "neutral",
      event.accountingKind,
      event.amount?.toString() ?? null,
      event.amountUsd?.toString() ?? null,
      formatUnits(event.amountUsd, event.usdDecimals),
      event.usdDecimals,
      event.usdStatus,
      "unpriced",
      Number(event.metadata.tokenCount ?? 0),
      duplicateOf,
      event.accountingRole === "duplicate",
      event.sourceProvenance,
      event.eventType,
      contractAddress,
      "ProtocolEvent",
      event.id,
      JSON.stringify({ adapter: event.sourceProvenance }),
      JSON.stringify(event.metadata),
    ],
  };
}

export const eventPersistencePlans = (event: ScannerEvent): SqlPlan[] => [
  ...(event.accountAddress ? [accountUpsertPlan(event.chainId, event.accountAddress)] : []),
  eventUpsertPlan(event),
];

export function legUpsertPlan(chainId: number, leg: ScannerEventTokenLeg): SqlPlan {
  return {
    text: `INSERT INTO cash_explorer.scanner_event_token_leg
      (id,scanner_event_id,token_id,leg_index,direction,raw_amount,amount_usd_raw,amount_usd,
       usd_decimals,usd_status,price_usd_e18,implied_price_usd)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET direction=EXCLUDED.direction,raw_amount=EXCLUDED.raw_amount,
       amount_usd_raw=EXCLUDED.amount_usd_raw,amount_usd=EXCLUDED.amount_usd,usd_decimals=EXCLUDED.usd_decimals,
       usd_status=EXCLUDED.usd_status,price_usd_e18=EXCLUDED.price_usd_e18,
       implied_price_usd=EXCLUDED.implied_price_usd,updated_at=now()`,
    values: [
      leg.id,
      leg.scannerEventId,
      tokenId(chainId, leg.tokenAddress),
      leg.tokenIndex,
      leg.direction,
      leg.amount.toString(),
      leg.amountUsd?.toString() ?? null,
      formatUnits(leg.amountUsd, leg.usdDecimals),
      leg.usdDecimals,
      leg.usdStatus,
      leg.priceUsdE18?.toString() ?? null,
      formatUnits(leg.priceUsdE18, 18),
    ],
  };
}

export const legPersistencePlans = (chainId: number, leg: ScannerEventTokenLeg): SqlPlan[] => [
  tokenUpsertPlan(chainId, leg.tokenAddress),
  legUpsertPlan(chainId, leg),
];

export function safeBalanceUpsertPlan(balance: SafeBalanceDto): SqlPlan {
  const accountId = `${balance.chainId}:${normalizeAddress(balance.safeAddress)}`;
  const id = `${accountId}:${normalizeAddress(balance.tokenAddress)}`;
  return {
    text: `INSERT INTO cash_explorer.account_token_metric
      (id,account_id,token_id,chain_id,balance_amount,safe_balance_amount,safe_inflow_amount,safe_outflow_amount,usd_status,updated_at)
      VALUES ($1,$2,$3,$4,$5,$5,$6,$7,'unpriced',$8)
      ON CONFLICT (id) DO UPDATE SET balance_amount=EXCLUDED.balance_amount,
       safe_balance_amount=EXCLUDED.safe_balance_amount,safe_inflow_amount=EXCLUDED.safe_inflow_amount,
       safe_outflow_amount=EXCLUDED.safe_outflow_amount,updated_at=GREATEST(cash_explorer.account_token_metric.updated_at,EXCLUDED.updated_at)`,
    values: [
      id,
      accountId,
      tokenId(balance.chainId, balance.tokenAddress),
      balance.chainId,
      balance.amount,
      balance.inflow,
      balance.outflow,
      balance.updatedAt,
    ],
  };
}

const sourceType = (observation: PriceObservation) =>
  observation.usage === "current"
    ? "current_cache"
    : observation.source === "chainlink"
      ? "chainlink_historical"
      : observation.source === "aave_oracle"
        ? "aave_oracle_historical"
        : observation.source === "price_provider"
          ? "price_provider_historical"
          : observation.source;

const priceSourceId = (observation: PriceObservation) =>
  `${tokenId(observation.chainId, observation.tokenAddress)}:${sourceType(observation)}`;

export const priceSourceUpsertPlan = (observation: PriceObservation): SqlPlan => ({
  text: `INSERT INTO cash_explorer.token_price_source (id,token_id,source_type,priority)
    VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET enabled=true,updated_at=now()`,
  values: [
    priceSourceId(observation),
    tokenId(observation.chainId, observation.tokenAddress),
    sourceType(observation),
    0,
  ],
});

export const priceObservationUpsertPlan = (observation: PriceObservation): SqlPlan => ({
  text: `INSERT INTO cash_explorer.token_price_observation
    (id,token_id,source_id,source_type,price_usd_e18,price_usd,price_status,observed_at,block_number,chain_id,is_finalized,source_payload)
    VALUES ($1,$2,$3,$4,$5,$6,'priced',$7,$8,$9,$10,$11::jsonb)
    ON CONFLICT (id) DO UPDATE SET price_usd_e18=EXCLUDED.price_usd_e18,price_usd=EXCLUDED.price_usd,
      source_id=EXCLUDED.source_id,source_type=EXCLUDED.source_type,price_status=EXCLUDED.price_status,
      is_finalized=EXCLUDED.is_finalized,source_payload=EXCLUDED.source_payload`,
  values: [
    observation.id,
    tokenId(observation.chainId, observation.tokenAddress),
    priceSourceId(observation),
    sourceType(observation),
    observation.priceUsdE18.toString(),
    formatUnits(observation.priceUsdE18, 18),
    observation.observedAt,
    observation.blockNumber,
    observation.chainId,
    observation.finalized,
    JSON.stringify({
      source: observation.source,
      usage: observation.usage ?? "historical",
      ...observation.sourcePayload,
    }),
  ],
});

export const priceAnomalyFromObservationPlan = (observation: PriceObservation): SqlPlan => ({
  text: `INSERT INTO cash_explorer.price_anomaly
    (id,token_id,candidate_observation_id,baseline_observation_id,deviation_ratio,verification_status)
    SELECT $1,$2,$1,current.observation_id,
      abs($3::numeric-current.price_usd_e18)/NULLIF(current.price_usd_e18,0),'pending'
    FROM cash_explorer.token_price_current current
    WHERE current.token_id=$2 AND current.price_usd_e18>0 AND current.observed_at < $4::timestamptz
      AND abs($3::numeric-current.price_usd_e18)/current.price_usd_e18 > 0.5
    ON CONFLICT (id) DO NOTHING`,
  values: [
    observation.id,
    tokenId(observation.chainId, observation.tokenAddress),
    observation.priceUsdE18.toString(),
    observation.observedAt,
  ],
});

export const priceCurrentFromObservationPlan = (observation: PriceObservation): SqlPlan => ({
  text: `INSERT INTO cash_explorer.token_price_current
    (token_id,observation_id,price_usd_e18,price_usd,price_status,source_type,observed_at,expires_at,refresh_after)
    VALUES ($1,$2,$3,$4,'priced',$5,$6,$6::timestamptz+interval '15 minutes',$6::timestamptz+interval '5 minutes')
    ON CONFLICT (token_id) DO UPDATE SET observation_id=EXCLUDED.observation_id,
      price_usd_e18=EXCLUDED.price_usd_e18,price_usd=EXCLUDED.price_usd,price_status='priced',
      source_type=EXCLUDED.source_type,observed_at=EXCLUDED.observed_at,expires_at=EXCLUDED.expires_at,
      refresh_after=EXCLUDED.refresh_after,updated_at=now()
    WHERE cash_explorer.token_price_current.observed_at IS NULL
      OR (cash_explorer.token_price_current.observed_at < EXCLUDED.observed_at
        AND (cash_explorer.token_price_current.price_usd_e18 IS NULL
          OR cash_explorer.token_price_current.price_usd_e18=0
          OR abs(EXCLUDED.price_usd_e18-cash_explorer.token_price_current.price_usd_e18)
             / cash_explorer.token_price_current.price_usd_e18 <= 0.5))`,
  values: [
    tokenId(observation.chainId, observation.tokenAddress),
    observation.id,
    observation.priceUsdE18.toString(),
    formatUnits(observation.priceUsdE18, 18),
    sourceType(observation),
    observation.observedAt,
  ],
});

// Retained as public helpers for callers that already construct cache/candidate DTOs.
export const priceCurrentUpsertPlan = (row: CurrentPrice): SqlPlan => ({
  ...priceCurrentFromObservationPlan({
    ...row,
    id: `${tokenId(row.chainId, row.tokenAddress)}:${row.observedAt}`,
    blockNumber: null,
    finalized: true,
  }),
});
export const priceCandidateUpsertPlan = (row: PriceCandidate): SqlPlan => priceAnomalyFromObservationPlan(row);

/** Persist event-first lending projections against the additive lending schema. */

const marketId = (chainId: number, spoke: string) => `${chainId}:${normalizeAddress(spoke)}`;
const reserveKey = (market: string, reserveNumber: bigint) => `${market}:${reserveNumber}`;
const lendingBalanceKind = (legType: string) => {
  if (
    ["borrow", "repay", "debt_restored", "deficit", "drawn_shares", "premium_shares", "premium_offset_ray"].includes(
      legType,
    )
  )
    return "protocol_debt";
  if (["supply", "withdraw", "supplied_shares"].includes(legType)) return "supplied";
  if (["collateral_seized", "liquidation_fee", "collateral", "collateral_toggle"].includes(legType))
    return "collateral";
  return "gross_assets";
};
export function lendingPersistencePlans(projection: LendingProjection): SqlPlan[] {
  const plans: SqlPlan[] = [];
  const markets = new Map<string, { chainId: number; address: string }>();
  const persistedReserveKeys = new Set(
    projection.reserves.flatMap((reserve) =>
      reserve.spokeAddress && reserve.tokenAddress
        ? [reserveKey(marketId(reserve.chainId, reserve.spokeAddress), BigInt(reserve.reserveId))]
        : [],
    ),
  );
  for (const event of projection.events)
    markets.set(marketId(event.chainId, event.marketAddress), { chainId: event.chainId, address: event.marketAddress });
  for (const reserve of projection.reserves)
    if (reserve.spokeAddress && reserve.tokenAddress) {
      const id = marketId(reserve.chainId, reserve.spokeAddress);
      markets.set(id, { chainId: reserve.chainId, address: reserve.spokeAddress });
      plans.push(tokenUpsertPlan(reserve.chainId, reserve.tokenAddress));
      plans.push({
        text: `INSERT INTO cash_explorer.lending_reserve (id,market_id,chain_id,asset_token_id,reserve_number,hub_asset_id,is_active,registered_block_number,state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (id) DO UPDATE SET asset_token_id=EXCLUDED.asset_token_id,is_active=EXCLUDED.is_active,state=EXCLUDED.state,updated_at=now()`,
        values: [
          reserveKey(id, BigInt(reserve.reserveId)),
          id,
          reserve.chainId,
          tokenId(reserve.chainId, reserve.tokenAddress),
          reserve.reserveId,
          reserve.hubAssetId,
          reserve.active,
          reserve.updatedBlock,
          JSON.stringify({
            gatewayAddress: reserve.gatewayAddress,
            gatewayRegistered: reserve.gatewayRegistered,
            hubAddress: reserve.hubAddress,
            transactionHash: reserve.transactionHash,
          }),
        ],
      });
    }
  for (const [id, market] of markets)
    plans.unshift({
      text: `INSERT INTO cash_explorer.lending_market (id,chain_id,address,spoke_address,metadata) VALUES ($1,$2,$3,$3,'{}'::jsonb) ON CONFLICT (id) DO UPDATE SET updated_at=now()`,
      values: [id, market.chainId, market.address],
    });
  for (const event of projection.events) {
    plans.push({
      text: `INSERT INTO cash_explorer.account_identity (id,address) VALUES ($1,$1) ON CONFLICT (id) DO UPDATE SET updated_at=now()`,
      values: [event.accountIdentityId],
    });
    plans.push(accountUpsertPlan(event.chainId, event.accountIdentityId));
    plans.push({
      text: `UPDATE cash_explorer.account SET identity_id=$2 WHERE id=$1`,
      values: [event.accountId, event.accountIdentityId],
    });
  }
  for (const action of projection.actions)
    plans.push({
      text: `INSERT INTO cash_explorer.economic_action (id,chain_id,account_id,account_identity_id,action_type,economic_key,transaction_hash,block_number,occurred_at,finality_status,provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'observed','{}'::jsonb) ON CONFLICT (chain_id,economic_key) DO UPDATE SET updated_at=now()`,
      values: [
        action.id,
        action.chainId,
        action.accountId,
        action.accountIdentityId,
        action.actionType,
        action.semanticKey,
        action.transactionHash,
        action.blockNumber,
        action.timestamp,
      ],
    });
  for (const event of projection.events) {
    const mid = marketId(event.chainId, event.marketAddress);
    const candidateReserveId = event.reserveId == null ? null : reserveKey(mid, event.reserveId);
    const rid = candidateReserveId && persistedReserveKeys.has(candidateReserveId) ? candidateReserveId : null;
    plans.push({
      text: `INSERT INTO cash_explorer.lending_event (id,chain_id,account_identity_id,economic_action_id,market_id,reserve_id,event_type,source_kind,source_contract_address,transaction_hash,log_index,block_number,occurred_at,finality_status,source_event_name,source_payload,source_provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'observed',$7,$14::jsonb,'{}'::jsonb) ON CONFLICT (id) DO UPDATE SET economic_action_id=EXCLUDED.economic_action_id,reserve_id=COALESCE(EXCLUDED.reserve_id,cash_explorer.lending_event.reserve_id),source_payload=EXCLUDED.source_payload,updated_at=now()`,
      values: [
        event.id,
        event.chainId,
        event.accountIdentityId,
        projection.actionSources.find((s) => s.lendingEventId === event.id)?.economicActionId ?? null,
        mid,
        rid,
        event.eventType,
        event.sourceKind,
        event.sourceAddress,
        event.transactionHash,
        event.logIndex,
        event.blockNumber,
        event.timestamp,
        event.metadata,
      ],
    });
  }
  for (const leg of projection.legs) {
    const event = projection.events.find((e) => e.id === leg.lendingEventId);
    if (!event || !leg.tokenId) continue;
    const candidateReserveId =
      leg.reserveId == null ? null : reserveKey(marketId(event.chainId, event.marketAddress), leg.reserveId);
    const rid = candidateReserveId && persistedReserveKeys.has(candidateReserveId) ? candidateReserveId : null;
    plans.push(tokenUpsertPlan(event.chainId, leg.tokenId.split(":", 2)[1]));
    plans.push({
      text: `INSERT INTO cash_explorer.lending_event_leg (id,lending_event_id,reserve_id,token_id,leg_index,balance_kind,leg_type,direction,raw_amount,supplied_shares_delta,drawn_shares_delta,premium_shares_delta,premium_offset_ray_delta,amount_usd,valuation_status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,'unpriced','{}'::jsonb) ON CONFLICT (id) DO UPDATE SET balance_kind=EXCLUDED.balance_kind,raw_amount=EXCLUDED.raw_amount,supplied_shares_delta=EXCLUDED.supplied_shares_delta,drawn_shares_delta=EXCLUDED.drawn_shares_delta,premium_shares_delta=EXCLUDED.premium_shares_delta,premium_offset_ray_delta=EXCLUDED.premium_offset_ray_delta`,
      values: [
        leg.id,
        leg.lendingEventId,
        rid,
        leg.tokenId,
        leg.legIndex,
        lendingBalanceKind(leg.legType),
        leg.legType,
        leg.direction === "informational" ? "neutral" : leg.direction,
        leg.amount?.toString() ?? "0",
        leg.suppliedSharesDelta?.toString() ?? "0",
        leg.drawnSharesDelta?.toString() ?? "0",
        leg.premiumSharesDelta?.toString() ?? "0",
        leg.premiumOffsetRayDelta?.toString() ?? "0",
      ],
    });
  }
  const sourcesByAction = new Map<string, typeof projection.actionSources>();
  for (const source of projection.actionSources)
    sourcesByAction.set(source.economicActionId, [...(sourcesByAction.get(source.economicActionId) ?? []), source]);
  for (const [actionId, sources] of sourcesByAction) {
    const primary = sources.find((source) => source.sourceKind === "spoke") ?? sources[0];
    for (const source of sources)
      plans.push({
        text: `INSERT INTO cash_explorer.economic_action_source (id,economic_action_id,lending_event_id,source_kind,source_role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (lending_event_id) DO UPDATE SET economic_action_id=EXCLUDED.economic_action_id,source_kind=EXCLUDED.source_kind,source_role=EXCLUDED.source_role`,
        values: [
          `${source.economicActionId}:${source.lendingEventId}`,
          source.economicActionId,
          source.lendingEventId,
          source.sourceKind,
          source === primary ? "primary" : "corroborating",
        ],
      });
    plans.push({
      text: `UPDATE cash_explorer.economic_action SET source_count=(SELECT count(*) FROM cash_explorer.economic_action_source WHERE economic_action_id=$1),updated_at=now() WHERE id=$1`,
      values: [actionId],
    });
  }
  return plans;
}
export function lendingSnapshotPersistencePlans(snapshot: LendingStateSnapshot): SqlPlan[] {
  if (!snapshot.blockHash) return [];
  const identity = normalizeAddress(snapshot.safeAddress),
    market = marketId(snapshot.chainId, snapshot.spokeAddress),
    blockHash = snapshot.blockHash;
  const plans: SqlPlan[] = [];
  const accountState =
    snapshot.archiveFailure != null
      ? "unavailable"
      : snapshot.riskPremiumRay != null &&
          snapshot.totalCollateralValueRaw != null &&
          snapshot.totalDebtValueRayRaw != null &&
          snapshot.healthFactorE18 != null &&
          snapshot.avgCollateralFactorE18 != null &&
          snapshot.activeCollateralCount != null &&
          snapshot.borrowCount != null
        ? "rpc_exact"
        : "partial";
  plans.push({
    text: `INSERT INTO cash_explorer.lending_account_snapshot (id,account_identity_id,chain_id,market_id,block_number,block_hash,snapshot_kind,risk_premium_ray,total_collateral_value_raw,total_debt_value_ray_raw,health_factor_e18,avg_collateral_factor_e18,active_collateral_count,borrow_count,valuation_status,state_status,state_source,finality_status,observed_at) VALUES ($1,$2,$3,$4,$5,$6,'refresh',$7,$8,$9,$10,$11,$12,$13,'unpriced',$14,'archive_multicall','finalized',now()) ON CONFLICT (id) DO UPDATE SET block_hash=EXCLUDED.block_hash,risk_premium_ray=EXCLUDED.risk_premium_ray,total_collateral_value_raw=EXCLUDED.total_collateral_value_raw,total_debt_value_ray_raw=EXCLUDED.total_debt_value_ray_raw,health_factor_e18=EXCLUDED.health_factor_e18,avg_collateral_factor_e18=EXCLUDED.avg_collateral_factor_e18,active_collateral_count=EXCLUDED.active_collateral_count,borrow_count=EXCLUDED.borrow_count,state_status=EXCLUDED.state_status,observed_at=now()`,
    values: [
      `${identity}:${market}:${snapshot.blockNumber}:refresh`,
      identity,
      snapshot.chainId,
      market,
      snapshot.blockNumber.toString(),
      blockHash,
      snapshot.riskPremiumRay?.toString() ?? null,
      snapshot.totalCollateralValueRaw?.toString() ?? null,
      snapshot.totalDebtValueRayRaw?.toString() ?? null,
      snapshot.healthFactorE18?.toString() ?? null,
      snapshot.avgCollateralFactorE18?.toString() ?? null,
      snapshot.activeCollateralCount?.toString() ?? 0,
      snapshot.borrowCount?.toString() ?? 0,
      accountState,
    ],
  });
  for (const [number, position] of snapshot.positions) {
    const reserve = reserveKey(market, number),
      id = `${identity}:${reserve}`,
      status = snapshot.reserveStatus.get(number),
      complete =
        position.walletBalance != null &&
        position.suppliedBalance != null &&
        position.totalDebt != null &&
        position.suppliedShares != null &&
        position.drawnShares != null &&
        position.premiumShares != null &&
        position.premiumOffsetRay != null &&
        status?.enabledAsCollateral != null &&
        status.borrowed != null,
      wallet = position.walletBalance ?? 0n,
      supplied = position.suppliedBalance ?? 0n,
      gross = complete ? wallet + supplied : 0n,
      state = complete && !snapshot.archiveFailure ? "rpc_exact" : "partial";
    plans.push({
      text: `INSERT INTO cash_explorer.lending_position (id,account_identity_id,reserve_id,chain_id,wallet_balance,supplied_balance,supplied_shares,drawn_shares,premium_shares,premium_offset_ray,using_as_collateral,gross_assets,protocol_debt,valuation_status,state_status,state_source,finality_status,state_block_number,state_block_hash,state_observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'unpriced',$14,'archive_multicall','finalized',$15,$16,now()) ON CONFLICT (id) DO UPDATE SET wallet_balance=EXCLUDED.wallet_balance,supplied_balance=EXCLUDED.supplied_balance,using_as_collateral=EXCLUDED.using_as_collateral,gross_assets=EXCLUDED.gross_assets,supplied_shares=EXCLUDED.supplied_shares,drawn_shares=EXCLUDED.drawn_shares,premium_shares=EXCLUDED.premium_shares,premium_offset_ray=EXCLUDED.premium_offset_ray,protocol_debt=EXCLUDED.protocol_debt,state_status=EXCLUDED.state_status`,
      values: [
        id,
        identity,
        reserve,
        snapshot.chainId,
        wallet.toString(),
        supplied.toString(),
        position.suppliedShares?.toString() ?? "0",
        position.drawnShares?.toString() ?? "0",
        position.premiumShares?.toString() ?? "0",
        position.premiumOffsetRay?.toString() ?? "0",
        status?.enabledAsCollateral ?? false,
        gross.toString(),
        position.totalDebt?.toString() ?? "0",
        state,
        snapshot.blockNumber.toString(),
        blockHash,
      ],
    });
    plans.push({
      text: `INSERT INTO cash_explorer.lending_position_snapshot (id,lending_position_id,account_identity_id,reserve_id,chain_id,block_number,block_hash,snapshot_kind,wallet_balance,supplied_balance,supplied_shares,drawn_shares,premium_shares,premium_offset_ray,using_as_collateral,gross_assets,protocol_debt,valuation_status,state_status,state_source,finality_status,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'refresh',$8,$9,$10,$11,$12,$13,$14,$15,$16,'unpriced',$17,'archive_multicall','finalized',now()) ON CONFLICT (id) DO UPDATE SET wallet_balance=EXCLUDED.wallet_balance,supplied_balance=EXCLUDED.supplied_balance,supplied_shares=EXCLUDED.supplied_shares,drawn_shares=EXCLUDED.drawn_shares,premium_shares=EXCLUDED.premium_shares,premium_offset_ray=EXCLUDED.premium_offset_ray,using_as_collateral=EXCLUDED.using_as_collateral,gross_assets=EXCLUDED.gross_assets,protocol_debt=EXCLUDED.protocol_debt,state_status=EXCLUDED.state_status,observed_at=now()`,
      values: [
        `${id}:${snapshot.blockNumber}:refresh`,
        id,
        identity,
        reserve,
        snapshot.chainId,
        snapshot.blockNumber.toString(),
        blockHash,
        wallet.toString(),
        supplied.toString(),
        position.suppliedShares?.toString() ?? "0",
        position.drawnShares?.toString() ?? "0",
        position.premiumShares?.toString() ?? "0",
        position.premiumOffsetRay?.toString() ?? "0",
        status?.enabledAsCollateral ?? false,
        gross.toString(),
        position.totalDebt?.toString() ?? "0",
        state,
      ],
    });
  }
  return plans;
}
