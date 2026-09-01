-- Cashback attribution layered on the additive Cash Explorer schema.
-- This migration is idempotent and touches only cash_explorer tables.
BEGIN;

ALTER TABLE cash_explorer.account_token_event
  ADD COLUMN IF NOT EXISTS cashback_recipient_address text,
  ADD COLUMN IF NOT EXISTS cashback_type numeric,
  ADD COLUMN IF NOT EXISTS cashback_paid boolean,
  ADD COLUMN IF NOT EXISTS cashback_attribution text;

-- cashbackType is uint256 on-chain.  0..3 have known labels, but other
-- values are valid source data and must remain queryable as raw numeric data.
ALTER TABLE cash_explorer.account_token_event
  ALTER COLUMN cashback_type TYPE numeric USING cashback_type::numeric;
ALTER TABLE cash_explorer.account_token_event
  DROP CONSTRAINT IF EXISTS account_token_event_cashback_type;
ALTER TABLE cash_explorer.account_token_event
  DROP CONSTRAINT IF EXISTS account_token_event_cashback_attribution;
ALTER TABLE cash_explorer.account_token_event
  DROP CONSTRAINT IF EXISTS account_token_event_category_direction;
ALTER TABLE cash_explorer.account_token_event
  ADD CONSTRAINT account_token_event_category_direction CHECK (
    (category IN ('deposit','borrow') AND direction='in')
    OR (category='cashback' AND direction IN ('in','neutral'))
    OR (category IN ('spend','withdrawal','repayment','fee') AND direction='out')
    OR category='other'
  ),
  ADD CONSTRAINT account_token_event_cashback_attribution CHECK (
    cashback_attribution IS NULL OR cashback_attribution IN ('self','referral','other_recipient','settlement')
  );

CREATE INDEX IF NOT EXISTS account_token_event_cashback_attribution_idx
  ON cash_explorer.account_token_event (account_id, cashback_attribution, cashback_type)
  WHERE category='cashback' AND status <> 'cancelled';

-- Preserve the source facts on every normalized cashback ledger row.  A
-- PendingCashbackCleared protocol event is a settlement credited to its actor
-- (the recipient); it is not a second generated reward.
UPDATE cash_explorer.account_token_event movement
SET cashback_recipient_address = CASE
      WHEN event.accounting_kind='cashback_received' THEN account.address
      WHEN event.accounting_kind='cashback' THEN lower(payload.value->>'recipient')
      ELSE NULL END,
    cashback_type = CASE
      WHEN event.accounting_kind='cashback' AND payload.value->>'cashbackType' ~ '^[0-9]+$'
        THEN (payload.value->>'cashbackType')::numeric
      ELSE NULL END,
    cashback_paid = CASE
      WHEN event.accounting_kind='cashback_received' THEN true
      WHEN event.accounting_kind='cashback' THEN COALESCE((payload.value->>'paid')::boolean,false)
      ELSE NULL END,
    cashback_attribution = CASE
      WHEN event.accounting_kind='cashback_received' THEN 'settlement'
      WHEN event.accounting_kind='cashback' AND lower(payload.value->>'recipient')=account.address THEN 'self'
      WHEN event.accounting_kind='cashback' AND payload.value->>'cashbackType'='3' THEN 'referral'
      WHEN event.accounting_kind='cashback' THEN 'other_recipient'
      ELSE NULL END,
    direction = CASE
      WHEN event.accounting_kind='cashback_received' THEN 'in'
      WHEN event.accounting_kind='cashback'
        AND COALESCE((payload.value->>'paid')::boolean,false)
        AND lower(payload.value->>'recipient')=account.address THEN 'in'
      WHEN event.accounting_kind='cashback' THEN 'neutral'
      ELSE movement.direction END,
    updated_at=now()
FROM cash_explorer.scanner_event event
JOIN cash_explorer.account account ON account.id=event.account_id
LEFT JOIN LATERAL (
  SELECT CASE WHEN jsonb_typeof(event.source_payload)='string'
    THEN (event.source_payload #>> '{}')::jsonb ELSE event.source_payload END AS value
) payload ON true
WHERE movement.scanner_event_id=event.id
  AND movement.category='cashback';

ALTER TABLE cash_explorer.account_metric
  ADD COLUMN IF NOT EXISTS lifetime_cashback_generated_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_generated_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_generated_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_received_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_received_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_received_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_generated_for_others_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_generated_for_others_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_generated_for_others_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_regular_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_regular_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_regular_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_spender_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_spender_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_spender_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_promotion_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_promotion_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_promotion_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_referral_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_referral_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_referral_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_other_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_other_usd numeric,
  ADD COLUMN IF NOT EXISTS lifetime_cashback_other_count bigint NOT NULL DEFAULT 0;

ALTER TABLE cash_explorer.account_token_metric
  ADD COLUMN IF NOT EXISTS cashback_generated_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_generated_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_generated_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_received_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_received_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_received_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_generated_for_others_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_generated_for_others_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_generated_for_others_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_regular_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_regular_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_regular_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_spender_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_spender_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_spender_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_promotion_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_promotion_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_promotion_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_referral_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_referral_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_referral_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_other_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_other_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_other_count bigint NOT NULL DEFAULT 0;

-- Compatibility staging columns used by the existing aggregate writer.  The
-- public account contract is the lifetime_cashback_* set above.
ALTER TABLE cash_explorer.account_metric
  ADD COLUMN IF NOT EXISTS cashback_generated_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_generated_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_generated_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_received_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_received_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_received_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_generated_for_others_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_generated_for_others_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_generated_for_others_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_regular_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_regular_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_regular_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_spender_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_spender_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_spender_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_promotion_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_promotion_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_promotion_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_referral_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_referral_usd numeric,
  ADD COLUMN IF NOT EXISTS cashback_referral_count bigint NOT NULL DEFAULT 0;

-- Rebuild the added per-token columns from the durable ledger.  Legacy
-- cashback_* is deliberately the received view for backwards compatibility.
WITH ledger AS (
  SELECT * FROM cash_explorer.account_token_event WHERE category='cashback' AND status <> 'cancelled'
), aggregate AS (
  SELECT account_id,token_id,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution IN ('self','referral','other_recipient')),0) AS generated_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution IN ('self','referral','other_recipient'))
      THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution IN ('self','referral','other_recipient')),0) END AS generated_usd,
    count(*) FILTER (WHERE cashback_attribution IN ('self','referral','other_recipient')) AS generated_count,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution='settlement' OR (cashback_attribution='self' AND cashback_paid)),0) AS received_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution='settlement' OR (cashback_attribution='self' AND cashback_paid))
      THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution='settlement' OR (cashback_attribution='self' AND cashback_paid)),0) END AS received_usd,
    count(*) FILTER (WHERE cashback_attribution='settlement' OR (cashback_attribution='self' AND cashback_paid)) AS received_count,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution IN ('referral','other_recipient')),0) AS others_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution IN ('referral','other_recipient'))
      THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution IN ('referral','other_recipient')),0) END AS others_usd,
    count(*) FILTER (WHERE cashback_attribution IN ('referral','other_recipient')) AS others_count,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=0),0) AS regular_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=0) THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=0),0) END AS regular_usd,
    count(*) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=0) AS regular_count,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=1),0) AS spender_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=1) THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=1),0) END AS spender_usd,
    count(*) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=1) AS spender_count,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=2),0) AS promotion_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=2) THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=2),0) END AS promotion_usd,
    count(*) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=2) AS promotion_count,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=3),0) AS referral_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=3) THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=3),0) END AS referral_usd,
    count(*) FILTER (WHERE cashback_attribution <> 'settlement' AND cashback_type=3) AS referral_count,
    COALESCE(sum(amount_raw) FILTER (WHERE cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))),0) AS other_amount,
    CASE WHEN bool_and(valuation_status='priced') FILTER (WHERE cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))) THEN COALESCE(sum(amount_usd) FILTER (WHERE cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))),0) END AS other_usd,
    count(*) FILTER (WHERE cashback_attribution <> 'settlement' AND (cashback_type IS NULL OR cashback_type NOT IN (0,1,2,3))) AS other_count
  FROM ledger GROUP BY account_id,token_id
)
UPDATE cash_explorer.account_token_metric metric SET
 cashback_amount=COALESCE(aggregate.received_amount,0),cashback_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.received_usd END,cashback_count=COALESCE(aggregate.received_count,0),
 cashback_generated_amount=COALESCE(aggregate.generated_amount,0),cashback_generated_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.generated_usd END,cashback_generated_count=COALESCE(aggregate.generated_count,0),
 cashback_received_amount=COALESCE(aggregate.received_amount,0),cashback_received_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.received_usd END,cashback_received_count=COALESCE(aggregate.received_count,0),
 cashback_generated_for_others_amount=COALESCE(aggregate.others_amount,0),cashback_generated_for_others_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.others_usd END,cashback_generated_for_others_count=COALESCE(aggregate.others_count,0),
 cashback_regular_amount=COALESCE(aggregate.regular_amount,0),cashback_regular_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.regular_usd END,cashback_regular_count=COALESCE(aggregate.regular_count,0),
 cashback_spender_amount=COALESCE(aggregate.spender_amount,0),cashback_spender_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.spender_usd END,cashback_spender_count=COALESCE(aggregate.spender_count,0),
 cashback_promotion_amount=COALESCE(aggregate.promotion_amount,0),cashback_promotion_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.promotion_usd END,cashback_promotion_count=COALESCE(aggregate.promotion_count,0),
 cashback_referral_amount=COALESCE(aggregate.referral_amount,0),cashback_referral_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.referral_usd END,cashback_referral_count=COALESCE(aggregate.referral_count,0),updated_at=now()
 ,cashback_other_amount=COALESCE(aggregate.other_amount,0),cashback_other_usd=CASE WHEN aggregate.account_id IS NULL THEN 0 ELSE aggregate.other_usd END,cashback_other_count=COALESCE(aggregate.other_count,0)
FROM aggregate WHERE metric.account_id=aggregate.account_id AND metric.token_id=aggregate.token_id;

UPDATE cash_explorer.account_metric account SET
 lifetime_cashback_generated_amount=totals.generated_amount,lifetime_cashback_generated_usd=totals.generated_usd,lifetime_cashback_generated_count=totals.generated_count,
 lifetime_cashback_received_amount=totals.received_amount,lifetime_cashback_received_usd=totals.received_usd,lifetime_cashback_received_count=totals.received_count,
 lifetime_cashback_generated_for_others_amount=totals.others_amount,lifetime_cashback_generated_for_others_usd=totals.others_usd,lifetime_cashback_generated_for_others_count=totals.others_count,
 lifetime_cashback_regular_amount=totals.regular_amount,lifetime_cashback_regular_usd=totals.regular_usd,lifetime_cashback_regular_count=totals.regular_count,
 lifetime_cashback_spender_amount=totals.spender_amount,lifetime_cashback_spender_usd=totals.spender_usd,lifetime_cashback_spender_count=totals.spender_count,
 lifetime_cashback_promotion_amount=totals.promotion_amount,lifetime_cashback_promotion_usd=totals.promotion_usd,lifetime_cashback_promotion_count=totals.promotion_count,
 lifetime_cashback_referral_amount=totals.referral_amount,lifetime_cashback_referral_usd=totals.referral_usd,lifetime_cashback_referral_count=totals.referral_count,
 lifetime_cashback_other_amount=totals.other_amount,lifetime_cashback_other_usd=totals.other_usd,lifetime_cashback_other_count=totals.other_count,
 lifetime_cashback_usd=totals.received_usd,updated_at=now()
FROM (
 SELECT metric.account_id,COALESCE(sum(cashback_generated_amount),0) generated_amount,CASE WHEN bool_and(cashback_generated_usd IS NOT NULL OR cashback_generated_count=0) THEN sum(COALESCE(cashback_generated_usd,0)) END generated_usd,COALESCE(sum(cashback_generated_count),0) generated_count,
  COALESCE(sum(cashback_received_amount),0) received_amount,CASE WHEN bool_and(cashback_received_usd IS NOT NULL OR cashback_received_count=0) THEN sum(COALESCE(cashback_received_usd,0)) END received_usd,COALESCE(sum(cashback_received_count),0) received_count,
  COALESCE(sum(cashback_generated_for_others_amount),0) others_amount,CASE WHEN bool_and(cashback_generated_for_others_usd IS NOT NULL OR cashback_generated_for_others_count=0) THEN sum(COALESCE(cashback_generated_for_others_usd,0)) END others_usd,COALESCE(sum(cashback_generated_for_others_count),0) others_count,
  COALESCE(sum(cashback_regular_amount),0) regular_amount,CASE WHEN bool_and(cashback_regular_usd IS NOT NULL OR cashback_regular_count=0) THEN sum(COALESCE(cashback_regular_usd,0)) END regular_usd,COALESCE(sum(cashback_regular_count),0) regular_count,
  COALESCE(sum(cashback_spender_amount),0) spender_amount,CASE WHEN bool_and(cashback_spender_usd IS NOT NULL OR cashback_spender_count=0) THEN sum(COALESCE(cashback_spender_usd,0)) END spender_usd,COALESCE(sum(cashback_spender_count),0) spender_count,
  COALESCE(sum(cashback_promotion_amount),0) promotion_amount,CASE WHEN bool_and(cashback_promotion_usd IS NOT NULL OR cashback_promotion_count=0) THEN sum(COALESCE(cashback_promotion_usd,0)) END promotion_usd,COALESCE(sum(cashback_promotion_count),0) promotion_count,
  COALESCE(sum(cashback_referral_amount),0) referral_amount,CASE WHEN bool_and(cashback_referral_usd IS NOT NULL OR cashback_referral_count=0) THEN sum(COALESCE(cashback_referral_usd,0)) END referral_usd,COALESCE(sum(cashback_referral_count),0) referral_count,
  COALESCE(sum(cashback_other_amount),0) other_amount,CASE WHEN bool_and(cashback_other_usd IS NOT NULL OR cashback_other_count=0) THEN sum(COALESCE(cashback_other_usd,0)) END other_usd,COALESCE(sum(cashback_other_count),0) other_count
 FROM cash_explorer.account_token_metric metric GROUP BY metric.account_id
) totals
WHERE account.id=totals.account_id;

-- AccountDailyMetric.cashback_usd is the received view, matching
-- AccountMetric.lifetime_cashback_usd. Generated cashback has its own totals.
UPDATE cash_explorer.account_daily_metric SET cashback_usd=0;
WITH received AS (
  SELECT account_id,timestamp::date AS day,
    CASE WHEN bool_and(valuation_status='priced')
      THEN COALESCE(sum(amount_usd),0) END AS cashback_usd
  FROM cash_explorer.account_token_event
  WHERE category='cashback' AND direction='in' AND status <> 'cancelled'
  GROUP BY account_id,timestamp::date
)
UPDATE cash_explorer.account_daily_metric metric
SET cashback_usd=received.cashback_usd,updated_at=now()
FROM received
WHERE metric.account_id=received.account_id AND metric.day=received.day;

COMMIT;
