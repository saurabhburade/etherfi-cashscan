import { backfillLockSql, type Checkpoint, checkpointUpsertSql } from "./cursor.js";
import {
  accountUpsertPlan,
  eventPersistencePlans,
  legPersistencePlans,
  priceAnomalyFromObservationPlan,
  priceCurrentFromObservationPlan,
  priceObservationUpsertPlan,
  priceSourceUpsertPlan,
  safeBalanceUpsertPlan,
  tokenMetadataUpsertPlan,
  tokenUpsertPlan,
} from "./repository.js";
import type { Projection } from "./types.js";

export type SqlExecutor = {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export class PostgresEnrichmentStore {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly dryRun = true,
  ) {}

  async tryAdvisoryLock() {
    return Boolean((await this.sql.query(backfillLockSql)).rows[0]?.acquired);
  }

  async readCheckpoint(name: string): Promise<Checkpoint | null> {
    const row = (
      await this.sql.query(
        "SELECT state, updated_at FROM cash_explorer.explorer_checkpoint WHERE checkpoint_kind=$1 ORDER BY updated_at DESC LIMIT 1",
        [name],
      )
    ).rows[0];
    if (!row) return null;
    const state = typeof row.state === "string" ? JSON.parse(row.state) : (row.state as Record<string, unknown>);
    return state.cursor
      ? { name, cursor: state.cursor as Checkpoint["cursor"], updatedAt: String(row.updated_at) }
      : null;
  }

  async writeProjection(projection: Projection) {
    if (this.dryRun) return;
    await this.sql.begin();
    try {
      const repricedTokenIds = new Set<string>();
      const expiredPrices = await this.sql.query(EXPIRE_STALE_PRICES_SQL);
      for (const row of expiredPrices.rows) repricedTokenIds.add(String(row.token_id));

      for (const token of projection.tokens) await execute(this.sql, tokenMetadataUpsertPlan(token));
      for (const event of projection.events)
        for (const plan of eventPersistencePlans(event)) await execute(this.sql, plan);

      const eventById = new Map(projection.events.map((event) => [event.id, event]));
      for (const leg of projection.legs) {
        const event = eventById.get(leg.scannerEventId);
        if (!event) continue;
        for (const plan of legPersistencePlans(event.chainId, leg)) await execute(this.sql, plan);
      }

      for (const balance of projection.safeBalances) {
        await execute(this.sql, accountUpsertPlan(balance.chainId, balance.safeAddress));
        await execute(this.sql, tokenUpsertPlan(balance.chainId, balance.tokenAddress));
        await execute(this.sql, safeBalanceUpsertPlan(balance));
      }

      for (const observation of projection.priceObservations) {
        repricedTokenIds.add(`${observation.chainId}:${observation.tokenAddress.toLowerCase()}`);
        await execute(this.sql, tokenUpsertPlan(observation.chainId, observation.tokenAddress));
        await execute(this.sql, priceSourceUpsertPlan(observation));
        await execute(this.sql, priceObservationUpsertPlan(observation));
        await execute(this.sql, priceAnomalyFromObservationPlan(observation));
        await execute(this.sql, priceCurrentFromObservationPlan(observation));
      }

      if (projection.events.length) {
        await this.sql.query(UPSERT_ACCOUNT_TOKEN_EVENTS_SQL, [projection.events.map((event) => event.id)]);
      }

      const accounts = new Set(
        projection.events.flatMap((event) =>
          event.accountAddress ? [`${event.chainId}:${event.accountAddress}`] : [],
        ),
      );
      for (const balance of projection.safeBalances)
        accounts.add(`${balance.chainId}:${balance.safeAddress.toLowerCase()}`);
      if (repricedTokenIds.size) {
        const repricedAccounts = await this.sql.query(ACCOUNTS_HOLDING_TOKENS_SQL, [[...repricedTokenIds]]);
        for (const row of repricedAccounts.rows) accounts.add(String(row.account_id));
      }
      for (const accountId of accounts) {
        await this.sql.query(RECOMPUTE_ACCOUNT_TOKEN_METRICS_SQL, [accountId]);
        await this.sql.query(RECOMPUTE_ACCOUNT_ANALYTICS_SQL, [accountId]);
        await this.sql.query(RECOMPUTE_CASHBACK_ACCOUNT_TOKEN_METRICS_SQL, [accountId]);
        await this.sql.query(RECOMPUTE_ACCOUNT_ROLLUP_SQL, [accountId]);
        await this.sql.query(RECOMPUTE_CASHBACK_ACCOUNT_ROLLUP_SQL, [accountId]);
      }

      const accountDays = new Set(
        projection.events.flatMap((event) =>
          event.accountAddress ? [`${event.chainId}:${event.accountAddress}:${event.timestamp.slice(0, 10)}`] : [],
        ),
      );
      for (const key of accountDays) {
        const day = key.slice(-10);
        await this.sql.query(RECOMPUTE_ACCOUNT_TOKEN_DAILY_METRICS_SQL, [key.slice(0, -11), day]);
        await this.sql.query(RECOMPUTE_ACCOUNT_DAILY_ANALYTICS_SQL, [key.slice(0, -11), day]);
      }

      const tokenDays = new Set<string>();
      for (const leg of projection.legs) {
        const event = eventById.get(leg.scannerEventId);
        if (event) tokenDays.add(`${event.chainId}:${leg.tokenAddress}:${event.timestamp.slice(0, 10)}`);
      }
      for (const key of tokenDays) {
        const day = key.slice(-10);
        await this.sql.query(RECOMPUTE_TOKEN_DAILY_METRICS_SQL, [key.slice(0, -11), day]);
      }
      await this.sql.commit();
    } catch (error) {
      await this.sql.rollback();
      throw error;
    }
  }

  async writeCheckpoint(checkpoint: Checkpoint) {
    if (this.dryRun || !checkpoint.cursor) return;
    const cursor = checkpoint.cursor;
    await this.sql.query(checkpointUpsertSql, [
      `${cursor.chainId}:${checkpoint.name}`,
      cursor.chainId,
      checkpoint.name,
      cursor.blockNumber,
      "unknown",
      cursor.logIndex,
      null,
      true,
      JSON.stringify({ cursor }),
    ]);
  }
}

const execute = (sql: SqlExecutor, plan: { text: string; values: unknown[] }) => sql.query(plan.text, plan.values);

export const EXPIRE_STALE_PRICES_SQL = `
UPDATE cash_explorer.token_price_current
SET price_usd_e18=NULL,price_usd=NULL,price_status='unpriced',updated_at=now()
WHERE price_status='priced' AND expires_at IS NOT NULL AND expires_at <= now()
RETURNING token_id`;

export const ACCOUNTS_HOLDING_TOKENS_SQL = `
SELECT DISTINCT account_id
FROM cash_explorer.account_token_metric
WHERE token_id=ANY($1::text[])`;

const ELIGIBLE =
  "('card_spend','topup','lend_borrowed','repay','repay_debt_manager','repay_lend_token_amount','cashback','cashback_received','withdrawal')";
const SOURCE_PAYLOAD = `CASE WHEN jsonb_typeof(e.source_payload)='string'
    THEN (e.source_payload #>> '{}')::jsonb ELSE e.source_payload END`;
const BASE = `FROM cash_explorer.scanner_event e
  JOIN cash_explorer.scanner_event_token_leg l ON l.scanner_event_id=e.id
  WHERE e.accounting_role='canonical' AND NOT e.is_audit_duplicate AND e.accounting_kind IN ${ELIGIBLE}`;
const ALL_PRICED = "bool_and(l.usd_status='priced' AND l.amount_usd IS NOT NULL)";
const USD = (predicate = "true") =>
  `CASE WHEN ${ALL_PRICED} THEN COALESCE(sum(l.amount_usd) FILTER (WHERE ${predicate}),0) ELSE NULL END`;

export const UPSERT_ACCOUNT_TOKEN_EVENTS_SQL = `
INSERT INTO cash_explorer.account_token_event
 (id,scanner_event_token_leg_id,scanner_event_id,account_id,token_id,chain_id,safe_address,token_address,
  category,direction,funding_mode,status,amount_raw,token_decimals,price_usd_e18,amount_usd,
  valuation_status,valuation_source,valuation_observed_at,valuation_basis,timestamp,block_number,
  transaction_hash,log_index,leg_index,source_event_name,canonical_movement_key,reconciliation_status,
  cashback_recipient_address,cashback_type,cashback_paid,cashback_attribution,updated_at)
SELECT l.id,l.id,e.id,e.account_id,l.token_id,e.chain_id,a.address,t.address,
  CASE
    WHEN e.accounting_kind='topup' THEN 'deposit'
    WHEN e.accounting_kind='card_spend' THEN 'spend'
    WHEN e.accounting_kind='withdrawal' THEN 'withdrawal'
    WHEN e.accounting_kind IN ('cashback','cashback_received') THEN 'cashback'
    WHEN e.accounting_kind='lend_borrowed' THEN 'borrow'
    WHEN e.accounting_kind IN ('repay','repay_debt_manager','repay_lend_token_amount') THEN 'repayment'
    WHEN e.event_type LIKE '%fee%' THEN 'fee'
    ELSE 'other'
  END,
  CASE
    WHEN e.accounting_kind='cashback_received' THEN 'in'
    WHEN e.accounting_kind='cashback' AND COALESCE((payload.value->>'paid')::boolean,false)
      AND lower(payload.value->>'recipient')=a.address THEN 'in'
    WHEN e.accounting_kind='cashback' THEN 'neutral'
    WHEN e.accounting_kind IN ('topup','lend_borrowed') THEN 'in'
    WHEN e.accounting_kind IN ('card_spend','withdrawal','repay','repay_debt_manager','repay_lend_token_amount') OR e.event_type LIKE '%fee%' THEN 'out'
    ELSE 'neutral'
  END,
  CASE WHEN e.accounting_kind='card_spend' THEN CASE WHEN e.mode=0 THEN 'credit' ELSE 'debit' END ELSE NULL END,
  CASE WHEN e.event_type LIKE '%cancel%' THEN 'cancelled' WHEN e.event_type='withdrawal_requested' THEN 'pending' ELSE 'completed' END,
  l.raw_amount,t.decimals,l.price_usd_e18,l.amount_usd,l.usd_status,
  CASE WHEN price_observation.source_type IS NOT NULL THEN price_observation.source_type
    WHEN l.price_usd_e18 IS NOT NULL THEN 'event_implied'
    WHEN l.amount_usd IS NOT NULL THEN 'event_amount_usd' ELSE NULL END,
  CASE WHEN l.amount_usd IS NOT NULL THEN COALESCE(price_observation.observed_at,e.timestamp) ELSE NULL END,
  'event_time',e.timestamp,e.block_number,
  e.transaction_hash,e.log_index,l.leg_index,e.source_event_name,l.id,'canonical_leg',
  CASE WHEN e.accounting_kind='cashback' THEN lower(payload.value->>'recipient')
    WHEN e.accounting_kind='cashback_received' THEN a.address ELSE NULL END,
  CASE WHEN e.accounting_kind='cashback' AND payload.value->>'cashbackType' ~ '^[0-9]+$'
    THEN (payload.value->>'cashbackType')::numeric ELSE NULL END,
  CASE WHEN e.accounting_kind='cashback' THEN COALESCE((payload.value->>'paid')::boolean,false)
    WHEN e.accounting_kind='cashback_received' THEN true ELSE NULL END,
  CASE WHEN e.accounting_kind='cashback_received' THEN 'settlement'
    WHEN e.accounting_kind='cashback' AND lower(payload.value->>'recipient')=a.address THEN 'self'
    WHEN e.accounting_kind='cashback' THEN 'other_recipient' ELSE NULL END,now()
FROM cash_explorer.scanner_event e
JOIN cash_explorer.scanner_event_token_leg l ON l.scanner_event_id=e.id
JOIN cash_explorer.account a ON a.id=e.account_id
JOIN cash_explorer.token t ON t.id=l.token_id
LEFT JOIN LATERAL (SELECT ${SOURCE_PAYLOAD} AS value) payload ON true
LEFT JOIN cash_explorer.token_price_observation price_observation ON price_observation.id=l.price_observation_id
WHERE e.id=ANY($1::text[]) AND e.accounting_role='canonical' AND NOT e.is_audit_duplicate
ON CONFLICT (scanner_event_token_leg_id) DO UPDATE SET
 category=EXCLUDED.category,direction=EXCLUDED.direction,funding_mode=EXCLUDED.funding_mode,status=EXCLUDED.status,
 amount_raw=EXCLUDED.amount_raw,token_decimals=EXCLUDED.token_decimals,price_usd_e18=EXCLUDED.price_usd_e18,
 amount_usd=EXCLUDED.amount_usd,valuation_status=EXCLUDED.valuation_status,valuation_source=EXCLUDED.valuation_source,
 valuation_observed_at=EXCLUDED.valuation_observed_at,source_event_name=EXCLUDED.source_event_name,
 cashback_recipient_address=EXCLUDED.cashback_recipient_address,
 cashback_type=EXCLUDED.cashback_type,cashback_paid=EXCLUDED.cashback_paid,
 cashback_attribution=EXCLUDED.cashback_attribution,updated_at=now()`;

export const RECOMPUTE_ACCOUNT_TOKEN_METRICS_SQL = `
INSERT INTO cash_explorer.account_token_metric
 (id,account_id,token_id,chain_id,credit_amount,credit_usd,debit_amount,debit_usd,event_count,volume_usd,
  spend_amount,spend_usd,spend_count,lend_borrowed_amount,lend_borrowed_usd,lend_borrowed_count,
  repay_amount,repay_usd,repay_count,repay_debt_manager_amount,repay_debt_manager_usd,repay_debt_manager_count,
  repay_lend_token_amount,repay_lend_token_usd,repay_lend_token_count,topup_amount,topup_usd,topup_count,
  cashback_amount,cashback_usd,cashback_count,withdrawal_requested_amount,withdrawal_requested_usd,
  withdrawal_requested_count,withdrawal_finalized_amount,withdrawal_finalized_usd,withdrawal_finalized_count,
  amount_usd,usd_status,last_event_id,updated_at)
SELECT e.account_id||':'||substring(l.token_id from position(':' in l.token_id)+1),
  e.account_id,l.token_id,e.chain_id,
  COALESCE(sum(l.raw_amount) FILTER (WHERE l.direction='credit'),0),${USD("l.direction='credit'")},
  COALESCE(sum(l.raw_amount) FILTER (WHERE l.direction='debit'),0),${USD("l.direction='debit'")},
  count(DISTINCT e.id),${USD()},
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='card_spend'),0),${USD("e.accounting_kind='card_spend'")},count(*) FILTER (WHERE e.accounting_kind='card_spend'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='lend_borrowed'),0),${USD("e.accounting_kind='lend_borrowed'")},count(*) FILTER (WHERE e.accounting_kind='lend_borrowed'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='repay'),0),${USD("e.accounting_kind='repay'")},count(*) FILTER (WHERE e.accounting_kind='repay'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='repay_debt_manager'),0),${USD("e.accounting_kind='repay_debt_manager'")},count(*) FILTER (WHERE e.accounting_kind='repay_debt_manager'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='repay_lend_token_amount'),0),${USD("e.accounting_kind='repay_lend_token_amount'")},count(*) FILTER (WHERE e.accounting_kind='repay_lend_token_amount'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='topup'),0),${USD("e.accounting_kind='topup'")},count(*) FILTER (WHERE e.accounting_kind='topup'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='cashback'),0),${USD("e.accounting_kind='cashback'")},count(*) FILTER (WHERE e.accounting_kind='cashback'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.event_type='withdrawal_requested'),0),${USD("e.event_type='withdrawal_requested'")},count(*) FILTER (WHERE e.event_type='withdrawal_requested'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.event_type IN ('withdrawal_processed','withdrawal_finalized')),0),${USD("e.event_type IN ('withdrawal_processed','withdrawal_finalized')")},count(*) FILTER (WHERE e.event_type IN ('withdrawal_processed','withdrawal_finalized')),
  ${USD()},CASE WHEN ${ALL_PRICED} THEN 'priced' ELSE 'unpriced' END,
  (array_agg(e.id ORDER BY e.timestamp DESC,e.chain_id ASC,e.block_number DESC,e.log_index DESC,e.id ASC))[1],now()
${BASE} AND e.account_id=$1
GROUP BY e.account_id,l.token_id,e.chain_id
ON CONFLICT (account_id,token_id) DO UPDATE SET
 credit_amount=EXCLUDED.credit_amount,credit_usd=EXCLUDED.credit_usd,debit_amount=EXCLUDED.debit_amount,debit_usd=EXCLUDED.debit_usd,
 event_count=EXCLUDED.event_count,volume_usd=EXCLUDED.volume_usd,spend_amount=EXCLUDED.spend_amount,spend_usd=EXCLUDED.spend_usd,spend_count=EXCLUDED.spend_count,
 lend_borrowed_amount=EXCLUDED.lend_borrowed_amount,lend_borrowed_usd=EXCLUDED.lend_borrowed_usd,lend_borrowed_count=EXCLUDED.lend_borrowed_count,
 repay_amount=EXCLUDED.repay_amount,repay_usd=EXCLUDED.repay_usd,repay_count=EXCLUDED.repay_count,
 repay_debt_manager_amount=EXCLUDED.repay_debt_manager_amount,repay_debt_manager_usd=EXCLUDED.repay_debt_manager_usd,repay_debt_manager_count=EXCLUDED.repay_debt_manager_count,
 repay_lend_token_amount=EXCLUDED.repay_lend_token_amount,repay_lend_token_usd=EXCLUDED.repay_lend_token_usd,repay_lend_token_count=EXCLUDED.repay_lend_token_count,
 topup_amount=EXCLUDED.topup_amount,topup_usd=EXCLUDED.topup_usd,topup_count=EXCLUDED.topup_count,
 cashback_amount=EXCLUDED.cashback_amount,cashback_usd=EXCLUDED.cashback_usd,cashback_count=EXCLUDED.cashback_count,
 withdrawal_requested_amount=EXCLUDED.withdrawal_requested_amount,withdrawal_requested_usd=EXCLUDED.withdrawal_requested_usd,withdrawal_requested_count=EXCLUDED.withdrawal_requested_count,
 withdrawal_finalized_amount=EXCLUDED.withdrawal_finalized_amount,withdrawal_finalized_usd=EXCLUDED.withdrawal_finalized_usd,withdrawal_finalized_count=EXCLUDED.withdrawal_finalized_count,
 amount_usd=EXCLUDED.amount_usd,usd_status=EXCLUDED.usd_status,last_event_id=EXCLUDED.last_event_id,updated_at=now()`;

const DAILY_SELECT = `
  COALESCE(sum(l.raw_amount) FILTER (WHERE l.direction='credit'),0),${USD("l.direction='credit'")},
  COALESCE(sum(l.raw_amount) FILTER (WHERE l.direction='debit'),0),${USD("l.direction='debit'")},count(DISTINCT e.id),${USD()},
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='card_spend'),0),${USD("e.accounting_kind='card_spend'")},count(*) FILTER (WHERE e.accounting_kind='card_spend'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='lend_borrowed'),0),${USD("e.accounting_kind='lend_borrowed'")},count(*) FILTER (WHERE e.accounting_kind='lend_borrowed'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='repay'),0),${USD("e.accounting_kind='repay'")},count(*) FILTER (WHERE e.accounting_kind='repay'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='repay_debt_manager'),0),${USD("e.accounting_kind='repay_debt_manager'")},count(*) FILTER (WHERE e.accounting_kind='repay_debt_manager'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='repay_lend_token_amount'),0),${USD("e.accounting_kind='repay_lend_token_amount'")},count(*) FILTER (WHERE e.accounting_kind='repay_lend_token_amount'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='topup'),0),${USD("e.accounting_kind='topup'")},count(*) FILTER (WHERE e.accounting_kind='topup'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.accounting_kind='cashback'),0),${USD("e.accounting_kind='cashback'")},count(*) FILTER (WHERE e.accounting_kind='cashback'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.event_type='withdrawal_requested'),0),${USD("e.event_type='withdrawal_requested'")},count(*) FILTER (WHERE e.event_type='withdrawal_requested'),
  COALESCE(sum(l.raw_amount) FILTER (WHERE e.event_type IN ('withdrawal_processed','withdrawal_finalized')),0),${USD("e.event_type IN ('withdrawal_processed','withdrawal_finalized')")},count(*) FILTER (WHERE e.event_type IN ('withdrawal_processed','withdrawal_finalized')),
  ${USD()},CASE WHEN ${ALL_PRICED} THEN 'priced' ELSE 'unpriced' END,now()`;

export const RECOMPUTE_ACCOUNT_TOKEN_DAILY_METRICS_SQL = `
INSERT INTO cash_explorer.account_token_daily_metric
 (id,account_token_metric_id,day,credit_amount,credit_usd,debit_amount,debit_usd,event_count,volume_usd,
  spend_amount,spend_usd,spend_count,lend_borrowed_amount,lend_borrowed_usd,lend_borrowed_count,
  repay_amount,repay_usd,repay_count,repay_debt_manager_amount,repay_debt_manager_usd,repay_debt_manager_count,
  repay_lend_token_amount,repay_lend_token_usd,repay_lend_token_count,topup_amount,topup_usd,topup_count,
  cashback_amount,cashback_usd,cashback_count,withdrawal_requested_amount,withdrawal_requested_usd,
  withdrawal_requested_count,withdrawal_finalized_amount,withdrawal_finalized_usd,withdrawal_finalized_count,
  amount_usd,usd_status,updated_at)
SELECT e.account_id||':'||substring(l.token_id from position(':' in l.token_id)+1)||':'||$2,
  e.account_id||':'||substring(l.token_id from position(':' in l.token_id)+1),$2::date,${DAILY_SELECT}
${BASE} AND e.account_id=$1 AND e.timestamp >= $2::date AND e.timestamp < $2::date+interval '1 day'
GROUP BY e.account_id,l.token_id
ON CONFLICT (account_token_metric_id,day) DO UPDATE SET
 credit_amount=EXCLUDED.credit_amount,credit_usd=EXCLUDED.credit_usd,debit_amount=EXCLUDED.debit_amount,debit_usd=EXCLUDED.debit_usd,event_count=EXCLUDED.event_count,volume_usd=EXCLUDED.volume_usd,
 spend_amount=EXCLUDED.spend_amount,spend_usd=EXCLUDED.spend_usd,spend_count=EXCLUDED.spend_count,lend_borrowed_amount=EXCLUDED.lend_borrowed_amount,lend_borrowed_usd=EXCLUDED.lend_borrowed_usd,lend_borrowed_count=EXCLUDED.lend_borrowed_count,
 repay_amount=EXCLUDED.repay_amount,repay_usd=EXCLUDED.repay_usd,repay_count=EXCLUDED.repay_count,repay_debt_manager_amount=EXCLUDED.repay_debt_manager_amount,repay_debt_manager_usd=EXCLUDED.repay_debt_manager_usd,repay_debt_manager_count=EXCLUDED.repay_debt_manager_count,
 repay_lend_token_amount=EXCLUDED.repay_lend_token_amount,repay_lend_token_usd=EXCLUDED.repay_lend_token_usd,repay_lend_token_count=EXCLUDED.repay_lend_token_count,topup_amount=EXCLUDED.topup_amount,topup_usd=EXCLUDED.topup_usd,topup_count=EXCLUDED.topup_count,
 cashback_amount=EXCLUDED.cashback_amount,cashback_usd=EXCLUDED.cashback_usd,cashback_count=EXCLUDED.cashback_count,withdrawal_requested_amount=EXCLUDED.withdrawal_requested_amount,withdrawal_requested_usd=EXCLUDED.withdrawal_requested_usd,withdrawal_requested_count=EXCLUDED.withdrawal_requested_count,
 withdrawal_finalized_amount=EXCLUDED.withdrawal_finalized_amount,withdrawal_finalized_usd=EXCLUDED.withdrawal_finalized_usd,withdrawal_finalized_count=EXCLUDED.withdrawal_finalized_count,amount_usd=EXCLUDED.amount_usd,usd_status=EXCLUDED.usd_status,updated_at=now()`;

export const RECOMPUTE_TOKEN_DAILY_METRICS_SQL = `
INSERT INTO cash_explorer.token_daily_metric
 (id,token_id,day,credit_amount,credit_usd,debit_amount,debit_usd,event_count,volume_usd,
  spend_amount,spend_usd,spend_count,lend_borrowed_amount,lend_borrowed_usd,lend_borrowed_count,
  repay_amount,repay_usd,repay_count,repay_debt_manager_amount,repay_debt_manager_usd,repay_debt_manager_count,
  repay_lend_token_amount,repay_lend_token_usd,repay_lend_token_count,topup_amount,topup_usd,topup_count,
  cashback_amount,cashback_usd,cashback_count,withdrawal_requested_amount,withdrawal_requested_usd,
  withdrawal_requested_count,withdrawal_finalized_amount,withdrawal_finalized_usd,withdrawal_finalized_count,
  amount_usd,usd_status,updated_at)
SELECT l.token_id||':'||$2,l.token_id,$2::date,${DAILY_SELECT}
${BASE} AND l.token_id=$1 AND e.timestamp >= $2::date AND e.timestamp < $2::date+interval '1 day'
GROUP BY l.token_id
ON CONFLICT (token_id,day) DO UPDATE SET
 credit_amount=EXCLUDED.credit_amount,credit_usd=EXCLUDED.credit_usd,debit_amount=EXCLUDED.debit_amount,debit_usd=EXCLUDED.debit_usd,event_count=EXCLUDED.event_count,volume_usd=EXCLUDED.volume_usd,
 spend_amount=EXCLUDED.spend_amount,spend_usd=EXCLUDED.spend_usd,spend_count=EXCLUDED.spend_count,lend_borrowed_amount=EXCLUDED.lend_borrowed_amount,lend_borrowed_usd=EXCLUDED.lend_borrowed_usd,lend_borrowed_count=EXCLUDED.lend_borrowed_count,
 repay_amount=EXCLUDED.repay_amount,repay_usd=EXCLUDED.repay_usd,repay_count=EXCLUDED.repay_count,repay_debt_manager_amount=EXCLUDED.repay_debt_manager_amount,repay_debt_manager_usd=EXCLUDED.repay_debt_manager_usd,repay_debt_manager_count=EXCLUDED.repay_debt_manager_count,
 repay_lend_token_amount=EXCLUDED.repay_lend_token_amount,repay_lend_token_usd=EXCLUDED.repay_lend_token_usd,repay_lend_token_count=EXCLUDED.repay_lend_token_count,topup_amount=EXCLUDED.topup_amount,topup_usd=EXCLUDED.topup_usd,topup_count=EXCLUDED.topup_count,
 cashback_amount=EXCLUDED.cashback_amount,cashback_usd=EXCLUDED.cashback_usd,cashback_count=EXCLUDED.cashback_count,withdrawal_requested_amount=EXCLUDED.withdrawal_requested_amount,withdrawal_requested_usd=EXCLUDED.withdrawal_requested_usd,withdrawal_requested_count=EXCLUDED.withdrawal_requested_count,
 withdrawal_finalized_amount=EXCLUDED.withdrawal_finalized_amount,withdrawal_finalized_usd=EXCLUDED.withdrawal_finalized_usd,withdrawal_finalized_count=EXCLUDED.withdrawal_finalized_count,amount_usd=EXCLUDED.amount_usd,usd_status=EXCLUDED.usd_status,updated_at=now()`;

const LEDGER_USD = (category: string, extra = "true") => `CASE
  WHEN count(*) FILTER (WHERE category='${category}' AND ${extra})=0 THEN 0
  WHEN bool_and(valuation_status='priced') FILTER (WHERE category='${category}' AND ${extra})
    THEN COALESCE(sum(amount_usd) FILTER (WHERE category='${category}' AND ${extra}),0)
  ELSE NULL END`;
const LEDGER_AMOUNT = (category: string, extra = "true") =>
  `COALESCE(sum(amount_raw) FILTER (WHERE category='${category}' AND ${extra}),0)`;
const LEDGER_COUNT = (category: string, extra = "true") =>
  `count(*) FILTER (WHERE category='${category}' AND ${extra})`;
const CASHBACK_GENERATED = "cashback_attribution IN ('self','referral','other_recipient')";
const CASHBACK_RECEIVED =
  "cashback_attribution='settlement' OR (cashback_paid AND cashback_recipient_address=safe_address)";
const CASHBACK_FOR_OTHERS = "cashback_attribution IN ('referral','other_recipient')";

export const RECOMPUTE_ACCOUNT_ANALYTICS_SQL = `
WITH ledger AS (
  SELECT * FROM cash_explorer.account_token_event WHERE account_id=$1 AND status <> 'cancelled'
), agg AS (
  SELECT token_id,
    count(*) FILTER (WHERE category='deposit') AS deposit_count,
    COALESCE(sum(amount_raw) FILTER (WHERE category='deposit'),0) AS deposited_amount,
    ${LEDGER_USD("deposit")} AS deposited_usd,
    count(*) FILTER (WHERE category='spend') AS spend_count,
    COALESCE(sum(amount_raw) FILTER (WHERE category='spend'),0) AS spent_amount,
    ${LEDGER_USD("spend")} AS spent_usd,
    ${LEDGER_USD("spend", "funding_mode='credit'")} AS credit_spend_usd,
    ${LEDGER_USD("spend", "funding_mode='debit'")} AS debit_spend_usd,
    count(*) FILTER (WHERE category='withdrawal') AS withdrawal_count,
    COALESCE(sum(amount_raw) FILTER (WHERE category='withdrawal'),0) AS withdrawn_amount,
    ${LEDGER_USD("withdrawal")} AS withdrawn_usd,
    ${LEDGER_AMOUNT("cashback", CASHBACK_RECEIVED)} AS cashback_amount,
    ${LEDGER_USD("cashback", CASHBACK_RECEIVED)} AS cashback_usd,
    ${LEDGER_AMOUNT("cashback", CASHBACK_GENERATED)} AS cashback_generated_amount,
    ${LEDGER_USD("cashback", CASHBACK_GENERATED)} AS cashback_generated_usd,
    ${LEDGER_COUNT("cashback", CASHBACK_GENERATED)} AS cashback_generated_count,
    ${LEDGER_AMOUNT("cashback", CASHBACK_RECEIVED)} AS cashback_received_amount,
    ${LEDGER_USD("cashback", CASHBACK_RECEIVED)} AS cashback_received_usd,
    ${LEDGER_COUNT("cashback", CASHBACK_RECEIVED)} AS cashback_received_count,
    ${LEDGER_AMOUNT("cashback", CASHBACK_FOR_OTHERS)} AS cashback_generated_for_others_amount,
    ${LEDGER_USD("cashback", CASHBACK_FOR_OTHERS)} AS cashback_generated_for_others_usd,
    ${LEDGER_COUNT("cashback", CASHBACK_FOR_OTHERS)} AS cashback_generated_for_others_count,
    ${LEDGER_AMOUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=0")} AS cashback_regular_amount,
    ${LEDGER_USD("cashback", "cashback_attribution <> 'settlement' AND cashback_type=0")} AS cashback_regular_usd,
    ${LEDGER_COUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=0")} AS cashback_regular_count,
    ${LEDGER_AMOUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=1")} AS cashback_spender_amount,
    ${LEDGER_USD("cashback", "cashback_attribution <> 'settlement' AND cashback_type=1")} AS cashback_spender_usd,
    ${LEDGER_COUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=1")} AS cashback_spender_count,
    ${LEDGER_AMOUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=2")} AS cashback_promotion_amount,
    ${LEDGER_USD("cashback", "cashback_attribution <> 'settlement' AND cashback_type=2")} AS cashback_promotion_usd,
    ${LEDGER_COUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=2")} AS cashback_promotion_count,
    ${LEDGER_AMOUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=3")} AS cashback_referral_amount,
    ${LEDGER_USD("cashback", "cashback_attribution <> 'settlement' AND cashback_type=3")} AS cashback_referral_usd,
    ${LEDGER_COUNT("cashback", "cashback_attribution <> 'settlement' AND cashback_type=3")} AS cashback_referral_count,
    ${LEDGER_AMOUNT("cashback", "cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))")} AS cashback_other_amount,
    ${LEDGER_USD("cashback", "cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))")} AS cashback_other_usd,
    ${LEDGER_COUNT("cashback", "cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))")} AS cashback_other_count,
    COALESCE(sum(amount_raw) FILTER (WHERE category='borrow'),0) AS borrowed_amount,
    ${LEDGER_USD("borrow")} AS borrowed_usd,
    COALESCE(sum(amount_raw) FILTER (WHERE category='repayment'),0) AS repaid_amount,
    ${LEDGER_USD("repayment")} AS repaid_usd,
    COALESCE(sum(amount_raw) FILTER (WHERE category='other' AND direction='in'),0) AS other_inflow_amount,
    COALESCE(sum(amount_raw) FILTER (WHERE category IN ('other','fee') AND direction='out'),0) AS other_outflow_amount,
    min(timestamp) AS first_activity_at,max(timestamp) AS last_activity_at
  FROM ledger GROUP BY token_id
)
UPDATE cash_explorer.account_token_metric metric SET
  deposit_count=COALESCE(agg.deposit_count,0),deposited_amount=COALESCE(agg.deposited_amount,0),deposited_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.deposited_usd END,
  spent_amount=COALESCE(agg.spent_amount,0),spent_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.spent_usd END,
  credit_spend_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.credit_spend_usd END,debit_spend_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.debit_spend_usd END,
  withdrawal_count=COALESCE(agg.withdrawal_count,0),withdrawn_amount=COALESCE(agg.withdrawn_amount,0),withdrawn_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.withdrawn_usd END,
  cashback_amount=COALESCE(agg.cashback_amount,0),cashback_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_usd END,
  cashback_count=COALESCE(agg.cashback_received_count,0),
  cashback_generated_amount=COALESCE(agg.cashback_generated_amount,0),cashback_generated_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_generated_usd END,cashback_generated_count=COALESCE(agg.cashback_generated_count,0),
  cashback_received_amount=COALESCE(agg.cashback_received_amount,0),cashback_received_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_received_usd END,cashback_received_count=COALESCE(agg.cashback_received_count,0),
  cashback_generated_for_others_amount=COALESCE(agg.cashback_generated_for_others_amount,0),cashback_generated_for_others_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_generated_for_others_usd END,cashback_generated_for_others_count=COALESCE(agg.cashback_generated_for_others_count,0),
  cashback_regular_amount=COALESCE(agg.cashback_regular_amount,0),cashback_regular_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_regular_usd END,cashback_regular_count=COALESCE(agg.cashback_regular_count,0),
  cashback_spender_amount=COALESCE(agg.cashback_spender_amount,0),cashback_spender_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_spender_usd END,cashback_spender_count=COALESCE(agg.cashback_spender_count,0),
  cashback_promotion_amount=COALESCE(agg.cashback_promotion_amount,0),cashback_promotion_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_promotion_usd END,cashback_promotion_count=COALESCE(agg.cashback_promotion_count,0),
  cashback_referral_amount=COALESCE(agg.cashback_referral_amount,0),cashback_referral_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_referral_usd END,cashback_referral_count=COALESCE(agg.cashback_referral_count,0),
  cashback_other_amount=COALESCE(agg.cashback_other_amount,0),cashback_other_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.cashback_other_usd END,cashback_other_count=COALESCE(agg.cashback_other_count,0),
  borrowed_amount=COALESCE(agg.borrowed_amount,0),borrowed_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.borrowed_usd END,
  repaid_amount=COALESCE(agg.repaid_amount,0),repaid_usd=CASE WHEN agg.token_id IS NULL THEN 0 ELSE agg.repaid_usd END,
  outstanding_debt_amount=GREATEST(COALESCE(agg.borrowed_amount,0)-COALESCE(agg.repaid_amount,0),0),
  outstanding_debt_usd=CASE WHEN agg.borrowed_usd IS NULL OR agg.repaid_usd IS NULL THEN NULL ELSE GREATEST(agg.borrowed_usd-agg.repaid_usd,0) END,
  other_inflow_amount=COALESCE(agg.other_inflow_amount,0),other_outflow_amount=COALESCE(agg.other_outflow_amount,0),
  current_balance_amount=metric.safe_balance_amount,
  current_balance_usd=CASE WHEN metric.safe_balance_amount=0 THEN 0 WHEN current.price_status='priced' AND current.expires_at>now() AND token.decimals IS NOT NULL
    THEN metric.safe_balance_amount/power(10::numeric,token.decimals)*current.price_usd ELSE NULL END,
  current_balance_valuation_status=CASE WHEN metric.safe_balance_amount=0 THEN 'priced' WHEN current.price_status='priced' AND current.expires_at>now() AND token.decimals IS NOT NULL THEN 'priced' ELSE 'unpriced' END,
  current_balance_price_observed_at=current.observed_at,
  first_activity_at=COALESCE(agg.first_activity_at,metric.first_activity_at),last_activity_at=COALESCE(agg.last_activity_at,metric.last_activity_at),updated_at=now()
FROM cash_explorer.token token
LEFT JOIN cash_explorer.token_price_current current ON current.token_id=token.id
LEFT JOIN agg ON agg.token_id=token.id
WHERE metric.account_id=$1 AND metric.token_id=token.id`;

export const RECOMPUTE_ACCOUNT_ROLLUP_SQL = `
INSERT INTO cash_explorer.account_metric
 (id,chain_id,safe_address,token_count,transaction_count,lifetime_deposited_usd,lifetime_spent_usd,
  lifetime_withdrawn_usd,lifetime_cashback_usd,credit_spend_usd,debit_spend_usd,borrowed_usd,repaid_usd,
  event_ledger_outstanding_debt_usd,debt_status,current_balance_usd,net_worth_usd,unpriced_position_count,
  first_activity_at,last_activity_at,lifetime_cashback_generated_amount,lifetime_cashback_generated_usd,lifetime_cashback_generated_count,
  lifetime_cashback_received_amount,lifetime_cashback_received_usd,lifetime_cashback_received_count,lifetime_cashback_generated_for_others_amount,
  lifetime_cashback_generated_for_others_usd,lifetime_cashback_generated_for_others_count,lifetime_cashback_regular_amount,lifetime_cashback_regular_usd,
  lifetime_cashback_regular_count,lifetime_cashback_spender_amount,lifetime_cashback_spender_usd,lifetime_cashback_spender_count,lifetime_cashback_promotion_amount,
  lifetime_cashback_promotion_usd,lifetime_cashback_promotion_count,lifetime_cashback_referral_amount,lifetime_cashback_referral_usd,lifetime_cashback_referral_count,updated_at)
SELECT account.id,account.chain_id,account.address,count(metric.id),
  (SELECT count(DISTINCT transaction_hash) FROM cash_explorer.account_token_event event WHERE event.account_id=account.id AND event.status<>'cancelled'),
  CASE WHEN count(*) FILTER (WHERE metric.deposit_count>0 AND metric.deposited_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.deposited_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.spend_count>0 AND metric.spent_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.spent_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.withdrawal_count>0 AND metric.withdrawn_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.withdrawn_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.cashback_count>0 AND metric.cashback_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.credit_spend_usd IS NULL AND metric.spend_count>0)>0 THEN NULL ELSE sum(COALESCE(metric.credit_spend_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.debit_spend_usd IS NULL AND metric.spend_count>0)>0 THEN NULL ELSE sum(COALESCE(metric.debit_spend_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.borrowed_amount>0 AND metric.borrowed_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.borrowed_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.repaid_amount>0 AND metric.repaid_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.repaid_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.outstanding_debt_amount>0 AND metric.outstanding_debt_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.outstanding_debt_usd,0)) END,
  'event_ledger_only',
  CASE WHEN count(*) FILTER (WHERE metric.current_balance_amount<>0 AND metric.current_balance_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.current_balance_usd,0)) END,
  CASE WHEN count(*) FILTER (WHERE metric.current_balance_amount<>0 AND metric.current_balance_usd IS NULL)>0
          OR count(*) FILTER (WHERE metric.outstanding_debt_amount>0 AND metric.outstanding_debt_usd IS NULL)>0
    THEN NULL ELSE sum(COALESCE(metric.current_balance_usd,0))-sum(COALESCE(metric.outstanding_debt_usd,0)) END,
  count(*) FILTER (WHERE metric.current_balance_amount<>0 AND metric.current_balance_usd IS NULL),
  min(metric.first_activity_at),max(metric.last_activity_at),
  sum(metric.cashback_generated_amount),CASE WHEN count(*) FILTER (WHERE metric.cashback_generated_count>0 AND metric.cashback_generated_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_generated_usd,0)) END,
  sum(metric.cashback_generated_count),
  sum(metric.cashback_received_amount),CASE WHEN count(*) FILTER (WHERE metric.cashback_received_count>0 AND metric.cashback_received_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_received_usd,0)) END,
  sum(metric.cashback_received_count),
  sum(metric.cashback_generated_for_others_amount),CASE WHEN count(*) FILTER (WHERE metric.cashback_generated_for_others_count>0 AND metric.cashback_generated_for_others_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_generated_for_others_usd,0)) END,
  sum(metric.cashback_generated_for_others_count),
  sum(metric.cashback_regular_amount),CASE WHEN count(*) FILTER (WHERE metric.cashback_regular_count>0 AND metric.cashback_regular_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_regular_usd,0)) END,
  sum(metric.cashback_regular_count),
  sum(metric.cashback_spender_amount),CASE WHEN count(*) FILTER (WHERE metric.cashback_spender_count>0 AND metric.cashback_spender_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_spender_usd,0)) END,
  sum(metric.cashback_spender_count),
  sum(metric.cashback_promotion_amount),CASE WHEN count(*) FILTER (WHERE metric.cashback_promotion_count>0 AND metric.cashback_promotion_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_promotion_usd,0)) END,
  sum(metric.cashback_promotion_count),
  sum(metric.cashback_referral_amount),CASE WHEN count(*) FILTER (WHERE metric.cashback_referral_count>0 AND metric.cashback_referral_usd IS NULL)>0 THEN NULL ELSE sum(COALESCE(metric.cashback_referral_usd,0)) END,
  sum(metric.cashback_referral_count),now()
FROM cash_explorer.account account
JOIN cash_explorer.account_token_metric metric ON metric.account_id=account.id
WHERE account.id=$1 GROUP BY account.id
ON CONFLICT (id) DO UPDATE SET token_count=EXCLUDED.token_count,transaction_count=EXCLUDED.transaction_count,
 lifetime_deposited_usd=EXCLUDED.lifetime_deposited_usd,lifetime_spent_usd=EXCLUDED.lifetime_spent_usd,
 lifetime_withdrawn_usd=EXCLUDED.lifetime_withdrawn_usd,lifetime_cashback_usd=EXCLUDED.lifetime_cashback_usd,
 lifetime_cashback_generated_amount=EXCLUDED.lifetime_cashback_generated_amount,lifetime_cashback_generated_usd=EXCLUDED.lifetime_cashback_generated_usd,lifetime_cashback_generated_count=EXCLUDED.lifetime_cashback_generated_count,
 lifetime_cashback_received_amount=EXCLUDED.lifetime_cashback_received_amount,lifetime_cashback_received_usd=EXCLUDED.lifetime_cashback_received_usd,lifetime_cashback_received_count=EXCLUDED.lifetime_cashback_received_count,
 lifetime_cashback_generated_for_others_amount=EXCLUDED.lifetime_cashback_generated_for_others_amount,lifetime_cashback_generated_for_others_usd=EXCLUDED.lifetime_cashback_generated_for_others_usd,lifetime_cashback_generated_for_others_count=EXCLUDED.lifetime_cashback_generated_for_others_count,
 lifetime_cashback_regular_amount=EXCLUDED.lifetime_cashback_regular_amount,lifetime_cashback_regular_usd=EXCLUDED.lifetime_cashback_regular_usd,lifetime_cashback_regular_count=EXCLUDED.lifetime_cashback_regular_count,
 lifetime_cashback_spender_amount=EXCLUDED.lifetime_cashback_spender_amount,lifetime_cashback_spender_usd=EXCLUDED.lifetime_cashback_spender_usd,lifetime_cashback_spender_count=EXCLUDED.lifetime_cashback_spender_count,
 lifetime_cashback_promotion_amount=EXCLUDED.lifetime_cashback_promotion_amount,lifetime_cashback_promotion_usd=EXCLUDED.lifetime_cashback_promotion_usd,lifetime_cashback_promotion_count=EXCLUDED.lifetime_cashback_promotion_count,
 lifetime_cashback_referral_amount=EXCLUDED.lifetime_cashback_referral_amount,lifetime_cashback_referral_usd=EXCLUDED.lifetime_cashback_referral_usd,lifetime_cashback_referral_count=EXCLUDED.lifetime_cashback_referral_count,
 credit_spend_usd=EXCLUDED.credit_spend_usd,debit_spend_usd=EXCLUDED.debit_spend_usd,
 borrowed_usd=EXCLUDED.borrowed_usd,repaid_usd=EXCLUDED.repaid_usd,event_ledger_outstanding_debt_usd=EXCLUDED.event_ledger_outstanding_debt_usd,
 current_balance_usd=EXCLUDED.current_balance_usd,net_worth_usd=EXCLUDED.net_worth_usd,unpriced_position_count=EXCLUDED.unpriced_position_count,
 first_activity_at=EXCLUDED.first_activity_at,last_activity_at=EXCLUDED.last_activity_at,updated_at=now()`;

const CASHBACK_USD = (predicate: string) => `CASE
  WHEN count(*) FILTER (WHERE ${predicate})=0 THEN 0
  WHEN bool_and(valuation_status='priced') FILTER (WHERE ${predicate})
    THEN COALESCE(sum(amount_usd) FILTER (WHERE ${predicate}),0)
  ELSE NULL END`;
const CASHBACK_BUCKETS = [
  ["generated", "cashback_attribution IN ('self','referral','other_recipient')"],
  ["received", "cashback_attribution='settlement' OR (cashback_paid AND cashback_recipient_address=safe_address)"],
  ["generated_for_others", "cashback_attribution IN ('referral','other_recipient')"],
  ["regular", "cashback_attribution <> 'settlement' AND cashback_type=0"],
  ["spender", "cashback_attribution <> 'settlement' AND cashback_type=1"],
  ["promotion", "cashback_attribution <> 'settlement' AND cashback_type=2"],
  ["referral", "cashback_attribution <> 'settlement' AND cashback_type=3"],
  ["other", "cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))"],
] as const;
const cashbackSelect = (prefix: string, predicate: string) => `
  COALESCE(sum(amount_raw) FILTER (WHERE ${predicate}),0) AS ${prefix}_amount,
  ${CASHBACK_USD(predicate)} AS ${prefix}_usd,
  count(*) FILTER (WHERE ${predicate}) AS ${prefix}_count`;
const cashbackUpdate = (prefix: string) =>
  `cashback_${prefix}_amount=COALESCE(aggregate.${prefix}_amount,0),cashback_${prefix}_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.${prefix}_usd END,cashback_${prefix}_count=COALESCE(aggregate.${prefix}_count,0)`;

/** Recomputes all cashback views from stored attribution, not event direction.
 * `cashback_*` remains the legacy received view. */
export const RECOMPUTE_CASHBACK_ACCOUNT_TOKEN_METRICS_SQL = `
WITH ledger AS (
  SELECT * FROM cash_explorer.account_token_event
  WHERE account_id=$1 AND category='cashback' AND status <> 'cancelled'
), aggregate AS (
  SELECT account_id,token_id,
    ${CASHBACK_BUCKETS.map(([name, predicate]) => cashbackSelect(name, predicate)).join(",")}
  FROM ledger GROUP BY account_id,token_id
)
UPDATE cash_explorer.account_token_metric metric SET
  cashback_amount=COALESCE(aggregate.received_amount,0),cashback_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.received_usd END,cashback_count=COALESCE(aggregate.received_count,0),
  ${CASHBACK_BUCKETS.map(([name]) => cashbackUpdate(name)).join(",")},updated_at=now()
FROM aggregate WHERE metric.account_id=$1 AND metric.account_id=aggregate.account_id AND metric.token_id=aggregate.token_id`;

const metricCashbackRollup = (prefix: string) => `
  COALESCE(sum(cashback_${prefix}_amount),0) AS ${prefix}_amount,
  CASE WHEN bool_and(cashback_${prefix}_usd IS NOT NULL OR cashback_${prefix}_count=0)
    THEN sum(COALESCE(cashback_${prefix}_usd,0)) END AS ${prefix}_usd,
  COALESCE(sum(cashback_${prefix}_count),0) AS ${prefix}_count`;
const accountCashbackUpdate = (prefix: string) =>
  `lifetime_cashback_${prefix}_amount=aggregate.${prefix}_amount,lifetime_cashback_${prefix}_usd=aggregate.${prefix}_usd,lifetime_cashback_${prefix}_count=aggregate.${prefix}_count`;

export const RECOMPUTE_CASHBACK_ACCOUNT_ROLLUP_SQL = `
WITH aggregate AS (
  SELECT ${CASHBACK_BUCKETS.map(([name]) => metricCashbackRollup(name)).join(",")}
  FROM cash_explorer.account_token_metric WHERE account_id=$1
)
UPDATE cash_explorer.account_metric account SET
  ${CASHBACK_BUCKETS.map(([name]) => accountCashbackUpdate(name)).join(",")},
  lifetime_cashback_usd=aggregate.received_usd,updated_at=now()
FROM aggregate WHERE account.id=$1`;

const DAILY_LEDGER_USD = (category: string, extra = "true") => `CASE
  WHEN count(*) FILTER (WHERE category='${category}' AND ${extra})=0 THEN 0
  WHEN bool_and(valuation_status='priced') FILTER (WHERE category='${category}' AND ${extra})
    THEN COALESCE(sum(amount_usd) FILTER (WHERE category='${category}' AND ${extra}),0)
  ELSE NULL END`;

export const RECOMPUTE_ACCOUNT_DAILY_ANALYTICS_SQL = `
INSERT INTO cash_explorer.account_daily_metric
 (id,account_id,token_id,day,chain_id,safe_address,deposited_usd,spent_usd,credit_spend_usd,debit_spend_usd,
  withdrawn_usd,cashback_usd,borrowed_usd,repaid_usd,other_inflow_usd,other_outflow_usd,
  closing_balance_usd,closing_balance_status,closing_balance_basis,transaction_count,pricing_coverage_ratio,updated_at)
SELECT account_id||':'||$2,account_id,NULL,$2::date,chain_id,safe_address,
  ${DAILY_LEDGER_USD("deposit")},${DAILY_LEDGER_USD("spend")},${DAILY_LEDGER_USD("spend", "funding_mode='credit'")},${DAILY_LEDGER_USD("spend", "funding_mode='debit'")},
  ${DAILY_LEDGER_USD("withdrawal")},${DAILY_LEDGER_USD("cashback", "direction='in'")},${DAILY_LEDGER_USD("borrow")},${DAILY_LEDGER_USD("repayment")},
  CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE category='other' AND direction='in') THEN COALESCE(sum(amount_usd) FILTER (WHERE category='other' AND direction='in'),0) ELSE NULL END,
  CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE category IN ('other','fee') AND direction='out') THEN COALESCE(sum(amount_usd) FILTER (WHERE category IN ('other','fee') AND direction='out'),0) ELSE NULL END,
  NULL,'not_reconstructed','not_derived_from_flows',count(DISTINCT transaction_hash),
  count(*) FILTER (WHERE valuation_status='priced')::numeric/NULLIF(count(*),0),now()
FROM cash_explorer.account_token_event
WHERE account_id=$1 AND timestamp >= $2::date AND timestamp < $2::date+interval '1 day' AND status <> 'cancelled'
GROUP BY account_id,chain_id,safe_address
ON CONFLICT (day,account_id,token_id) DO UPDATE SET deposited_usd=EXCLUDED.deposited_usd,spent_usd=EXCLUDED.spent_usd,
 credit_spend_usd=EXCLUDED.credit_spend_usd,debit_spend_usd=EXCLUDED.debit_spend_usd,withdrawn_usd=EXCLUDED.withdrawn_usd,
 cashback_usd=EXCLUDED.cashback_usd,borrowed_usd=EXCLUDED.borrowed_usd,repaid_usd=EXCLUDED.repaid_usd,
 other_inflow_usd=EXCLUDED.other_inflow_usd,other_outflow_usd=EXCLUDED.other_outflow_usd,
 transaction_count=EXCLUDED.transaction_count,pricing_coverage_ratio=EXCLUDED.pricing_coverage_ratio,updated_at=now()`;

export function graphqlHttpTransport(
  url: string,
  fetcher: typeof fetch = fetch,
  adminSecret = process.env.ENVIO_HASURA_ADMIN_SECRET,
) {
  return async (query: string, variables: Record<string, unknown>) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (adminSecret) headers["x-hasura-admin-secret"] = adminSecret;
    const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
    return (await response.json()) as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  };
}

export function requiredWorkerEnv(env: Record<string, string | undefined> = process.env) {
  const databaseUrl = env.DATABASE_URL;
  const graphqlUrl = env.ENVIO_GRAPHQL_URL;
  if (!databaseUrl || !graphqlUrl) throw new Error("DATABASE_URL and ENVIO_GRAPHQL_URL are required");
  return { databaseUrl, graphqlUrl };
}
