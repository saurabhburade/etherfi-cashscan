import {
  fetchHistoricalPriceProviderPrices,
  type HistoricalPriceCall,
  type HistoricalPriceResult,
  PRICE_PROVIDER_ADDRESS,
  priceUsdE6ToE18,
  rpcBlockNumber,
  rpcBlockTimestamp,
  tokenAmountUsdE6,
} from "./price-provider-rpc.js";
import { deviationBps, type PriceObservation } from "./pricing.js";
import {
  formatUnits,
  priceAnomalyFromObservationPlan,
  priceCurrentFromObservationPlan,
  priceObservationUpsertPlan,
  priceSourceUpsertPlan,
} from "./repository.js";
import {
  ACCOUNTS_HOLDING_TOKENS_SQL,
  RECOMPUTE_ACCOUNT_ANALYTICS_SQL,
  RECOMPUTE_ACCOUNT_DAILY_ANALYTICS_SQL,
  RECOMPUTE_ACCOUNT_ROLLUP_SQL,
  RECOMPUTE_ACCOUNT_TOKEN_DAILY_METRICS_SQL,
  RECOMPUTE_ACCOUNT_TOKEN_METRICS_SQL,
  RECOMPUTE_TOKEN_DAILY_METRICS_SQL,
  type SqlExecutor,
  UPSERT_ACCOUNT_TOKEN_EVENTS_SQL,
} from "./worker.js";

type HistoricalLeg = {
  legId: string;
  eventId: string;
  accountId: string | null;
  tokenId: string;
  tokenAddress: `0x${string}`;
  tokenDecimals: number;
  rawAmount: bigint;
  timestamp: string;
  day: string;
  blockNumber: bigint;
  baselinePriceUsdE18: bigint | null;
};

export type PriceBackfillProgress = {
  batch: number;
  selected: number;
  priced: number;
  unavailable: number;
  anomalous: number;
  calls: number;
  lastBlock: string | null;
  lastLegId: string | null;
};

export async function runHistoricalPriceBackfill(
  sql: SqlExecutor,
  options: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
    rpcUrl: string;
    fallbackRpcUrl?: string;
    batchSize?: number;
    maxBatches?: number;
    dryRun?: boolean;
    providerAddress?: `0x${string}`;
    onBatch?: (progress: PriceBackfillProgress) => void;
  },
): Promise<PriceBackfillProgress[]> {
  const providerAddress = options.providerAddress ?? PRICE_PROVIDER_ADDRESS;
  const batchSize = options.batchSize ?? 500;
  const maxBatches = options.maxBatches ?? 1;
  let cursorBlock = options.fromBlock;
  let cursorLegId = "";
  const progress: PriceBackfillProgress[] = [];
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const legs = await selectHistoricalLegs(
      sql,
      options.chainId,
      options.fromBlock,
      options.toBlock,
      cursorBlock,
      cursorLegId,
      batchSize,
    );
    if (!legs.length) break;
    const calls = legs.map((leg) => ({
      chainId: options.chainId,
      tokenAddress: leg.tokenAddress,
      blockNumber: leg.blockNumber,
    }));
    const primary = await fetchHistoricalPriceProviderPrices({
      rpcUrl: options.rpcUrl,
      calls,
      providerAddress,
    });
    const needsFallback = primary.filter((result, index) => {
      const baseline = legs[index].baselinePriceUsdE18;
      return (
        result.priceUsdE6 == null ||
        (baseline != null && deviationBps(priceUsdE6ToE18(result.priceUsdE6), baseline) > 5_000n)
      );
    });
    const fallback =
      options.fallbackRpcUrl && needsFallback.length
        ? await fetchHistoricalPriceProviderPrices({
            rpcUrl: options.fallbackRpcUrl,
            calls: needsFallback,
            providerAddress,
          })
        : [];
    const fallbackByKey = new Map(fallback.map((row) => [callKey(row), row]));
    let priced = 0;
    let unavailable = 0;
    let anomalous = 0;
    const accepted: Array<{ leg: HistoricalLeg; result: HistoricalPriceResult; observation: PriceObservation }> = [];
    for (let index = 0; index < legs.length; index += 1) {
      const leg = legs[index];
      let result = primary[index];
      const secondary = fallbackByKey.get(callKey(result));
      if (result.priceUsdE6 == null && secondary?.priceUsdE6 != null) result = secondary;
      if (result.priceUsdE6 == null) {
        unavailable += 1;
        continue;
      }
      const priceUsdE18 = priceUsdE6ToE18(result.priceUsdE6);
      if (leg.baselinePriceUsdE18 != null && deviationBps(priceUsdE18, leg.baselinePriceUsdE18) > 5_000n) {
        const corroborated =
          secondary?.priceUsdE6 != null && deviationBps(priceUsdE18, priceUsdE6ToE18(secondary.priceUsdE6)) <= 100n;
        if (!corroborated) {
          anomalous += 1;
          continue;
        }
      }
      accepted.push({
        leg,
        result,
        observation: {
          id: `${leg.tokenId}:price_provider:${leg.blockNumber}`,
          chainId: options.chainId,
          tokenAddress: leg.tokenAddress,
          source: "price_provider",
          priceUsdE18,
          observedAt: leg.timestamp,
          blockNumber: leg.blockNumber.toString(),
          finalized: true,
          usage: "historical",
          sourcePayload: { providerAddress, rpcBlockTag: `0x${leg.blockNumber.toString(16)}`, exactBlock: true },
        },
      });
      priced += 1;
    }
    if (!options.dryRun && accepted.length) await persistHistoricalPrices(sql, accepted);
    const last = legs.at(-1)!;
    cursorBlock = last.blockNumber;
    cursorLegId = last.legId;
    const item = {
      batch,
      selected: legs.length,
      priced,
      unavailable,
      anomalous,
      calls: new Set(calls.map(callKey)).size,
      lastBlock: cursorBlock.toString(),
      lastLegId: cursorLegId,
    };
    progress.push(item);
    options.onBatch?.(item);
    if (legs.length < batchSize) break;
  }
  return progress;
}

export async function refreshCurrentPrices(
  sql: SqlExecutor,
  options: {
    chainId: number;
    rpcUrl: string;
    confirmations?: bigint;
    limit?: number;
    dryRun?: boolean;
    providerAddress?: `0x${string}`;
  },
) {
  const providerAddress = options.providerAddress ?? PRICE_PROVIDER_ADDRESS;
  const head = await rpcBlockNumber(options.rpcUrl);
  const blockNumber = head > (options.confirmations ?? 20n) ? head - (options.confirmations ?? 20n) : head;
  const observedAt = await rpcBlockTimestamp(options.rpcUrl, blockNumber);
  const rows = (
    await sql.query(
      `SELECT token.id AS token_id,token.address AS token_address
       FROM cash_explorer.token token
       LEFT JOIN cash_explorer.token_price_current current ON current.token_id=token.id
       WHERE token.chain_id=$1 AND EXISTS (
         SELECT 1 FROM cash_explorer.scanner_event_token_leg leg WHERE leg.token_id=token.id
         UNION ALL
         SELECT 1 FROM cash_explorer.account_token_metric metric
         WHERE metric.token_id=token.id AND metric.safe_balance_amount<>0
       ) AND (current.token_id IS NULL OR current.price_status<>'priced' OR current.refresh_after<=now())
       ORDER BY token.id LIMIT $2`,
      [options.chainId, options.limit ?? 1_000],
    )
  ).rows;
  const calls: HistoricalPriceCall[] = rows.map((row) => ({
    chainId: options.chainId,
    tokenAddress: String(row.token_address) as `0x${string}`,
    blockNumber,
  }));
  const results = await fetchHistoricalPriceProviderPrices({ rpcUrl: options.rpcUrl, calls, providerAddress });
  const observations = results.flatMap((result): PriceObservation[] =>
    result.priceUsdE6 == null
      ? []
      : [
          {
            id: `${options.chainId}:${result.tokenAddress.toLowerCase()}:price_provider:current:${blockNumber}`,
            chainId: options.chainId,
            tokenAddress: result.tokenAddress,
            source: "price_provider",
            priceUsdE18: priceUsdE6ToE18(result.priceUsdE6),
            observedAt,
            blockNumber: blockNumber.toString(),
            finalized: true,
            usage: "current",
            sourcePayload: { providerAddress, rpcBlockTag: `0x${blockNumber.toString(16)}`, finalized: true },
          },
        ],
  );
  if (!options.dryRun && observations.length) await persistCurrentPrices(sql, observations);
  return {
    blockNumber: blockNumber.toString(),
    selected: calls.length,
    priced: observations.length,
    unavailable: calls.length - observations.length,
  };
}

async function selectHistoricalLegs(
  sql: SqlExecutor,
  chainId: number,
  fromBlock: bigint,
  toBlock: bigint,
  cursorBlock: bigint,
  cursorLegId: string,
  limit: number,
): Promise<HistoricalLeg[]> {
  const rows = (
    await sql.query(
      `SELECT leg.id AS leg_id,event.id AS event_id,event.account_id,leg.token_id,token.address AS token_address,
        token.decimals,leg.raw_amount,event.timestamp,event.timestamp::date::text AS day,event.block_number,
        baseline.price_usd_e18 AS baseline_price_usd_e18
       FROM cash_explorer.scanner_event_token_leg leg
       JOIN cash_explorer.scanner_event event ON event.id=leg.scanner_event_id
       JOIN cash_explorer.token token ON token.id=leg.token_id
       LEFT JOIN LATERAL (
         SELECT observation.price_usd_e18
         FROM cash_explorer.token_price_observation observation
         WHERE observation.token_id=leg.token_id AND observation.price_status='priced'
           AND observation.observed_at<=event.timestamp
           AND observation.observed_at>=event.timestamp-interval '15 minutes'
           AND (observation.block_number IS NULL OR observation.block_number<=event.block_number)
         ORDER BY CASE observation.source_type WHEN 'event_implied' THEN 0 WHEN 'chainlink_historical' THEN 1 ELSE 2 END,
           observation.observed_at DESC LIMIT 1
       ) baseline ON true
       WHERE event.chain_id=$1 AND event.block_number BETWEEN $2 AND $3
         AND event.accounting_role='canonical' AND NOT event.is_audit_duplicate
         AND leg.usd_status<>'priced' AND leg.raw_amount>0
         AND token.decimals IS NOT NULL AND token.decimals_verified
         AND (event.block_number>$4 OR (event.block_number=$4 AND leg.id>$5))
       ORDER BY event.block_number,leg.id LIMIT $6`,
      [chainId, fromBlock.toString(), toBlock.toString(), cursorBlock.toString(), cursorLegId, limit],
    )
  ).rows;
  return rows.map((row) => ({
    legId: String(row.leg_id),
    eventId: String(row.event_id),
    accountId: row.account_id == null ? null : String(row.account_id),
    tokenId: String(row.token_id),
    tokenAddress: String(row.token_address) as `0x${string}`,
    tokenDecimals: Number(row.decimals),
    rawAmount: BigInt(String(row.raw_amount)),
    timestamp: new Date(String(row.timestamp)).toISOString(),
    day: String(row.day),
    blockNumber: BigInt(String(row.block_number)),
    baselinePriceUsdE18: row.baseline_price_usd_e18 == null ? null : BigInt(String(row.baseline_price_usd_e18)),
  }));
}

async function persistHistoricalPrices(
  sql: SqlExecutor,
  accepted: Array<{ leg: HistoricalLeg; result: HistoricalPriceResult; observation: PriceObservation }>,
) {
  await sql.begin();
  try {
    const observations = new Map(accepted.map((row) => [row.observation.id, row.observation]));
    for (const observation of observations.values()) {
      await executePlan(sql, priceSourceUpsertPlan(observation));
      await executePlan(sql, priceObservationUpsertPlan(observation));
    }
    for (const row of accepted) {
      const amountUsdE6 = tokenAmountUsdE6(row.leg.rawAmount, row.leg.tokenDecimals, row.result.priceUsdE6!);
      await sql.query(
        `UPDATE cash_explorer.scanner_event_token_leg SET amount_usd_raw=$2,amount_usd=$3,usd_decimals=6,
          usd_status='priced',price_usd_e18=$4,implied_price_usd=$5,price_observation_id=$6,updated_at=now()
         WHERE id=$1 AND usd_status<>'priced'`,
        [
          row.leg.legId,
          amountUsdE6.toString(),
          formatUnits(amountUsdE6, 6),
          row.observation.priceUsdE18.toString(),
          formatUnits(row.observation.priceUsdE18, 18),
          row.observation.id,
        ],
      );
    }
    const eventIds = [...new Set(accepted.map((row) => row.leg.eventId))];
    await sql.query(
      `UPDATE cash_explorer.scanner_event event SET
        amount_usd_raw=aggregate.amount_usd_raw,amount_usd=aggregate.amount_usd,
        usd_status=aggregate.usd_status,price_status=aggregate.usd_status,updated_at=now()
       FROM (SELECT scanner_event_id,
         CASE WHEN bool_and(usd_status='priced') THEN sum(amount_usd_raw) ELSE NULL END amount_usd_raw,
         CASE WHEN bool_and(usd_status='priced') THEN sum(amount_usd) ELSE NULL END amount_usd,
         CASE WHEN bool_and(usd_status='priced') THEN 'priced' ELSE 'unpriced' END usd_status
         FROM cash_explorer.scanner_event_token_leg WHERE scanner_event_id=ANY($1::text[]) GROUP BY scanner_event_id) aggregate
       WHERE event.id=aggregate.scanner_event_id`,
      [eventIds],
    );
    await sql.query(UPSERT_ACCOUNT_TOKEN_EVENTS_SQL, [eventIds]);
    await recomputeAffected(sql, accepted);
    await sql.commit();
  } catch (error) {
    await sql.rollback();
    throw error;
  }
}

async function persistCurrentPrices(sql: SqlExecutor, observations: PriceObservation[]) {
  await sql.begin();
  try {
    for (const observation of observations) {
      await executePlan(sql, priceSourceUpsertPlan(observation));
      await executePlan(sql, priceObservationUpsertPlan(observation));
      await executePlan(sql, priceAnomalyFromObservationPlan(observation));
      await executePlan(sql, priceCurrentFromObservationPlan(observation));
    }
    const tokenIds = observations.map((row) => `${row.chainId}:${row.tokenAddress.toLowerCase()}`);
    const accounts = await sql.query(ACCOUNTS_HOLDING_TOKENS_SQL, [tokenIds]);
    for (const row of accounts.rows) {
      const accountId = String(row.account_id);
      await sql.query(RECOMPUTE_ACCOUNT_ANALYTICS_SQL, [accountId]);
      await sql.query(RECOMPUTE_ACCOUNT_ROLLUP_SQL, [accountId]);
    }
    await sql.commit();
  } catch (error) {
    await sql.rollback();
    throw error;
  }
}

async function recomputeAffected(sql: SqlExecutor, accepted: Array<{ leg: HistoricalLeg }>) {
  const accounts = new Set(accepted.flatMap((row) => (row.leg.accountId ? [row.leg.accountId] : [])));
  for (const accountId of accounts) {
    await sql.query(RECOMPUTE_ACCOUNT_TOKEN_METRICS_SQL, [accountId]);
    await sql.query(RECOMPUTE_ACCOUNT_ANALYTICS_SQL, [accountId]);
    await sql.query(RECOMPUTE_ACCOUNT_ROLLUP_SQL, [accountId]);
  }
  const accountDays = new Set(
    accepted.flatMap((row) => (row.leg.accountId ? [`${row.leg.accountId}|${row.leg.day}`] : [])),
  );
  for (const key of accountDays) {
    const [accountId, day] = key.split("|");
    await sql.query(RECOMPUTE_ACCOUNT_TOKEN_DAILY_METRICS_SQL, [accountId, day]);
    await sql.query(RECOMPUTE_ACCOUNT_DAILY_ANALYTICS_SQL, [accountId, day]);
  }
  const tokenDays = new Set(accepted.map((row) => `${row.leg.tokenId}|${row.leg.day}`));
  for (const key of tokenDays) {
    const [tokenId, day] = key.split("|");
    await sql.query(RECOMPUTE_TOKEN_DAILY_METRICS_SQL, [tokenId, day]);
  }
}

const executePlan = (sql: SqlExecutor, plan: { text: string; values: unknown[] }) => sql.query(plan.text, plan.values);
const callKey = (call: HistoricalPriceCall) => `${call.chainId}:${call.blockNumber}:${call.tokenAddress.toLowerCase()}`;
