import { normalizeAddress, tokenId } from "./ids.js";
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
