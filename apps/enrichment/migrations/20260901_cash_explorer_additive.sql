-- Additive Cash Explorer persistence contract.
--
-- This migration owns only the `cash_explorer` schema. It does not alter,
-- query, or otherwise depend on Envio-generated tables, and it is safe to run
-- repeatedly. It does not reset, truncate, or backfill any table.

BEGIN;

CREATE SCHEMA IF NOT EXISTS cash_explorer;

CREATE TABLE IF NOT EXISTS cash_explorer.account (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  address text NOT NULL,
  account_kind text NOT NULL DEFAULT 'safe',
  owner_address text,
  first_seen_at timestamptz,
  first_seen_block_number bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_chain_address_key UNIQUE (chain_id, address),
  CONSTRAINT account_id_matches_chain_address CHECK (id = chain_id::text || ':' || address)
);

CREATE TABLE IF NOT EXISTS cash_explorer.token (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  address text NOT NULL,
  symbol text,
  name text,
  decimals integer,
  decimals_verified boolean NOT NULL DEFAULT false,
  metadata_status text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT token_chain_address_key UNIQUE (chain_id, address),
  CONSTRAINT token_id_matches_chain_address CHECK (id = chain_id::text || ':' || address),
  CONSTRAINT token_decimals_range CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 255)
);

CREATE TABLE IF NOT EXISTS cash_explorer.scanner_event (
  -- Canonical ID is exactly chainId:transactionHash:logIndex.
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  -- Historical Envio GraphQL rows may not include the hash; retain provenance
  -- and finalized_at so a later source pass can fill it without reindexing.
  block_hash text,
  timestamp timestamptz NOT NULL,
  account_id text REFERENCES cash_explorer.account(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  actor_address text,
  event_type text NOT NULL,
  mode integer,
  accounting_role text NOT NULL DEFAULT 'canonical',
  canonical_group_id text REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  accounting_direction text NOT NULL,
  accounting_kind text NOT NULL,
  amount numeric,
  -- Exact on-chain/provider integer units; amount_usd is normalized human USD.
  amount_usd_raw numeric,
  amount_usd numeric,
  usd_decimals integer NOT NULL DEFAULT 6,
  price_usd_e18 numeric,
  price_usd numeric,
  usd_status text NOT NULL DEFAULT 'unpriced',
  price_status text NOT NULL DEFAULT 'unpriced',
  token_count integer NOT NULL DEFAULT 0,
  audit_duplicate_of_id text REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  is_audit_duplicate boolean NOT NULL DEFAULT false,
  source_name text NOT NULL,
  source_event_name text NOT NULL,
  source_contract_address text,
  source_entity_type text,
  source_entity_id text,
  source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  finalized_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Most IDs are the canonical chain:tx:log key. Envio may append an array
  -- index for multiple logical records emitted by one log; retain that suffix
  -- while the transaction/log prefix remains canonical and auditable.
  CONSTRAINT scanner_event_id_format CHECK (
    id = chain_id::text || ':' || transaction_hash || ':' || log_index::text
    OR id LIKE chain_id::text || ':' || transaction_hash || ':' || log_index::text || ':%'
  ),
  CONSTRAINT scanner_event_direction CHECK (accounting_direction IN ('credit', 'debit', 'neutral')),
  CONSTRAINT scanner_event_accounting_role CHECK (accounting_role IN ('canonical', 'audit', 'duplicate')),
  CONSTRAINT scanner_event_usd_status CHECK (usd_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT scanner_event_price_status CHECK (price_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT scanner_event_usd_decimals_range CHECK (usd_decimals BETWEEN 0 AND 255),
  CONSTRAINT scanner_event_unpriced_usd_is_null CHECK (usd_status = 'priced' OR (amount_usd IS NULL AND amount_usd_raw IS NULL)),
  CONSTRAINT scanner_event_unpriced_price_is_null CHECK (price_status = 'priced' OR (price_usd IS NULL AND price_usd_e18 IS NULL)),
  CONSTRAINT scanner_event_duplicate_link CHECK (
    (accounting_role IN ('canonical', 'audit') AND NOT is_audit_duplicate AND audit_duplicate_of_id IS NULL AND canonical_group_id IS NULL)
    OR (accounting_role = 'duplicate' AND is_audit_duplicate AND audit_duplicate_of_id IS NOT NULL AND canonical_group_id IS NOT NULL)
  ),
  CONSTRAINT scanner_event_no_self_duplicate CHECK (audit_duplicate_of_id IS NULL OR audit_duplicate_of_id <> id),
  CONSTRAINT scanner_event_token_count_nonnegative CHECK (token_count >= 0)
);

CREATE TABLE IF NOT EXISTS cash_explorer.scanner_event_token_leg (
  id text PRIMARY KEY,
  scanner_event_id text NOT NULL REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  leg_index integer NOT NULL,
  direction text NOT NULL,
  raw_amount numeric NOT NULL,
  amount_usd_raw numeric,
  amount_usd numeric,
  usd_decimals integer NOT NULL DEFAULT 6,
  usd_status text NOT NULL DEFAULT 'unpriced',
  price_usd_e18 numeric,
  implied_price_usd numeric,
  price_observation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scanner_event_token_leg_event_index_key UNIQUE (scanner_event_id, leg_index),
  CONSTRAINT scanner_event_token_leg_direction CHECK (direction IN ('credit', 'debit', 'neutral')),
  CONSTRAINT scanner_event_token_leg_usd_status CHECK (usd_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT scanner_event_token_leg_usd_decimals_range CHECK (usd_decimals BETWEEN 0 AND 255),
  CONSTRAINT scanner_event_token_leg_unpriced_usd_is_null CHECK (usd_status = 'priced' OR (amount_usd IS NULL AND amount_usd_raw IS NULL)),
  CONSTRAINT scanner_event_token_leg_index_nonnegative CHECK (leg_index >= 0)
);

CREATE TABLE IF NOT EXISTS cash_explorer.account_token_metric (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES cash_explorer.account(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  chain_id integer NOT NULL,
  balance_amount numeric NOT NULL DEFAULT 0,
  safe_balance_amount numeric NOT NULL DEFAULT 0,
  safe_inflow_amount numeric NOT NULL DEFAULT 0,
  safe_outflow_amount numeric NOT NULL DEFAULT 0,
  credit_amount numeric NOT NULL DEFAULT 0,
  credit_usd numeric,
  debit_amount numeric NOT NULL DEFAULT 0,
  debit_usd numeric,
  event_count bigint NOT NULL DEFAULT 0,
  volume_usd numeric,
  spend_amount numeric NOT NULL DEFAULT 0,
  spend_usd numeric,
  spend_count bigint NOT NULL DEFAULT 0,
  lend_borrowed_amount numeric NOT NULL DEFAULT 0,
  lend_borrowed_usd numeric,
  lend_borrowed_count bigint NOT NULL DEFAULT 0,
  repay_amount numeric NOT NULL DEFAULT 0,
  repay_usd numeric,
  repay_count bigint NOT NULL DEFAULT 0,
  repay_debt_manager_amount numeric NOT NULL DEFAULT 0,
  repay_debt_manager_usd numeric,
  repay_debt_manager_count bigint NOT NULL DEFAULT 0,
  repay_lend_token_amount numeric NOT NULL DEFAULT 0,
  repay_lend_token_usd numeric,
  repay_lend_token_count bigint NOT NULL DEFAULT 0,
  topup_amount numeric NOT NULL DEFAULT 0,
  topup_usd numeric,
  topup_count bigint NOT NULL DEFAULT 0,
  cashback_amount numeric NOT NULL DEFAULT 0,
  cashback_usd numeric,
  cashback_count bigint NOT NULL DEFAULT 0,
  withdrawal_requested_amount numeric NOT NULL DEFAULT 0,
  withdrawal_requested_usd numeric,
  withdrawal_requested_count bigint NOT NULL DEFAULT 0,
  withdrawal_finalized_amount numeric NOT NULL DEFAULT 0,
  withdrawal_finalized_usd numeric,
  withdrawal_finalized_count bigint NOT NULL DEFAULT 0,
  amount_usd numeric,
  usd_status text NOT NULL DEFAULT 'unpriced',
  last_event_id text REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_token_metric_account_token_key UNIQUE (account_id, token_id),
  CONSTRAINT account_token_metric_usd_status CHECK (usd_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT account_token_metric_unpriced_usd_is_null CHECK (
    usd_status = 'priced' OR (amount_usd IS NULL AND credit_usd IS NULL AND debit_usd IS NULL AND volume_usd IS NULL AND spend_usd IS NULL AND lend_borrowed_usd IS NULL
      AND repay_usd IS NULL AND repay_debt_manager_usd IS NULL AND repay_lend_token_usd IS NULL
      AND topup_usd IS NULL AND cashback_usd IS NULL AND withdrawal_requested_usd IS NULL AND withdrawal_finalized_usd IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS cash_explorer.account_token_daily_metric (
  id text PRIMARY KEY,
  account_token_metric_id text NOT NULL REFERENCES cash_explorer.account_token_metric(id) ON UPDATE CASCADE ON DELETE CASCADE,
  day date NOT NULL,
  credit_amount numeric NOT NULL DEFAULT 0,
  credit_usd numeric,
  debit_amount numeric NOT NULL DEFAULT 0,
  debit_usd numeric,
  event_count bigint NOT NULL DEFAULT 0,
  volume_usd numeric,
  spend_amount numeric NOT NULL DEFAULT 0,
  spend_usd numeric,
  spend_count bigint NOT NULL DEFAULT 0,
  lend_borrowed_amount numeric NOT NULL DEFAULT 0,
  lend_borrowed_usd numeric,
  lend_borrowed_count bigint NOT NULL DEFAULT 0,
  repay_amount numeric NOT NULL DEFAULT 0,
  repay_usd numeric,
  repay_count bigint NOT NULL DEFAULT 0,
  repay_debt_manager_amount numeric NOT NULL DEFAULT 0,
  repay_debt_manager_usd numeric,
  repay_debt_manager_count bigint NOT NULL DEFAULT 0,
  repay_lend_token_amount numeric NOT NULL DEFAULT 0,
  repay_lend_token_usd numeric,
  repay_lend_token_count bigint NOT NULL DEFAULT 0,
  topup_amount numeric NOT NULL DEFAULT 0,
  topup_usd numeric,
  topup_count bigint NOT NULL DEFAULT 0,
  cashback_amount numeric NOT NULL DEFAULT 0,
  cashback_usd numeric,
  cashback_count bigint NOT NULL DEFAULT 0,
  withdrawal_requested_amount numeric NOT NULL DEFAULT 0,
  withdrawal_requested_usd numeric,
  withdrawal_requested_count bigint NOT NULL DEFAULT 0,
  withdrawal_finalized_amount numeric NOT NULL DEFAULT 0,
  withdrawal_finalized_usd numeric,
  withdrawal_finalized_count bigint NOT NULL DEFAULT 0,
  amount_usd numeric,
  usd_status text NOT NULL DEFAULT 'unpriced',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_token_daily_metric_key UNIQUE (account_token_metric_id, day),
  CONSTRAINT account_token_daily_metric_usd_status CHECK (usd_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT account_token_daily_metric_unpriced_usd_is_null CHECK (
    usd_status = 'priced' OR (amount_usd IS NULL AND credit_usd IS NULL AND debit_usd IS NULL AND volume_usd IS NULL AND spend_usd IS NULL AND lend_borrowed_usd IS NULL
      AND repay_usd IS NULL AND repay_debt_manager_usd IS NULL AND repay_lend_token_usd IS NULL
      AND topup_usd IS NULL AND cashback_usd IS NULL AND withdrawal_requested_usd IS NULL AND withdrawal_finalized_usd IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS cash_explorer.token_daily_metric (
  id text PRIMARY KEY,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE CASCADE,
  day date NOT NULL,
  credit_amount numeric NOT NULL DEFAULT 0,
  credit_usd numeric,
  debit_amount numeric NOT NULL DEFAULT 0,
  debit_usd numeric,
  event_count bigint NOT NULL DEFAULT 0,
  volume_usd numeric,
  spend_amount numeric NOT NULL DEFAULT 0,
  spend_usd numeric,
  spend_count bigint NOT NULL DEFAULT 0,
  lend_borrowed_amount numeric NOT NULL DEFAULT 0,
  lend_borrowed_usd numeric,
  lend_borrowed_count bigint NOT NULL DEFAULT 0,
  repay_amount numeric NOT NULL DEFAULT 0,
  repay_usd numeric,
  repay_count bigint NOT NULL DEFAULT 0,
  repay_debt_manager_amount numeric NOT NULL DEFAULT 0,
  repay_debt_manager_usd numeric,
  repay_debt_manager_count bigint NOT NULL DEFAULT 0,
  repay_lend_token_amount numeric NOT NULL DEFAULT 0,
  repay_lend_token_usd numeric,
  repay_lend_token_count bigint NOT NULL DEFAULT 0,
  topup_amount numeric NOT NULL DEFAULT 0,
  topup_usd numeric,
  topup_count bigint NOT NULL DEFAULT 0,
  cashback_amount numeric NOT NULL DEFAULT 0,
  cashback_usd numeric,
  cashback_count bigint NOT NULL DEFAULT 0,
  withdrawal_requested_amount numeric NOT NULL DEFAULT 0,
  withdrawal_requested_usd numeric,
  withdrawal_requested_count bigint NOT NULL DEFAULT 0,
  withdrawal_finalized_amount numeric NOT NULL DEFAULT 0,
  withdrawal_finalized_usd numeric,
  withdrawal_finalized_count bigint NOT NULL DEFAULT 0,
  amount_usd numeric,
  usd_status text NOT NULL DEFAULT 'unpriced',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT token_daily_metric_key UNIQUE (token_id, day),
  CONSTRAINT token_daily_metric_usd_status CHECK (usd_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT token_daily_metric_unpriced_usd_is_null CHECK (
    usd_status = 'priced' OR (amount_usd IS NULL AND credit_usd IS NULL AND debit_usd IS NULL AND volume_usd IS NULL AND spend_usd IS NULL AND lend_borrowed_usd IS NULL
      AND repay_usd IS NULL AND repay_debt_manager_usd IS NULL AND repay_lend_token_usd IS NULL
      AND topup_usd IS NULL AND cashback_usd IS NULL AND withdrawal_requested_usd IS NULL AND withdrawal_finalized_usd IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS cash_explorer.token_price_source (
  id text PRIMARY KEY,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_type text NOT NULL,
  source_address text,
  source_identifier text,
  priority integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT token_price_source_key UNIQUE (token_id, source_type, source_identifier),
  CONSTRAINT token_price_source_type CHECK (source_type IN ('event_implied', 'chainlink_historical', 'price_provider_historical', 'current_cache'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.token_price_observation (
  id text PRIMARY KEY,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_id text REFERENCES cash_explorer.token_price_source(id) ON UPDATE CASCADE ON DELETE SET NULL,
  source_type text NOT NULL,
  price_usd_e18 numeric,
  price_usd numeric,
  price_status text NOT NULL,
  observed_at timestamptz NOT NULL,
  block_number bigint,
  block_hash text,
  chain_id integer NOT NULL,
  transaction_hash text,
  scanner_event_id text REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE SET NULL,
  is_finalized boolean NOT NULL DEFAULT false,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT token_price_observation_status CHECK (price_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT token_price_observation_unpriced_value CHECK (price_status = 'priced' OR (price_usd IS NULL AND price_usd_e18 IS NULL)),
  CONSTRAINT token_price_observation_source_type CHECK (source_type IN ('event_implied', 'chainlink_historical', 'price_provider_historical', 'current_cache'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.token_price_current (
  token_id text PRIMARY KEY REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE CASCADE,
  observation_id text REFERENCES cash_explorer.token_price_observation(id) ON UPDATE CASCADE ON DELETE SET NULL,
  price_usd_e18 numeric,
  price_usd numeric,
  price_status text NOT NULL,
  source_type text,
  observed_at timestamptz,
  expires_at timestamptz,
  refresh_after timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT token_price_current_status CHECK (price_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT token_price_current_unpriced_value CHECK (price_status = 'priced' OR (price_usd IS NULL AND price_usd_e18 IS NULL)),
  CONSTRAINT token_price_current_windows CHECK (
    (expires_at IS NULL OR observed_at IS NULL OR expires_at <= observed_at + interval '15 minutes')
    AND (refresh_after IS NULL OR observed_at IS NULL OR refresh_after <= observed_at + interval '5 minutes')
    AND (expires_at IS NULL OR refresh_after IS NULL OR refresh_after <= expires_at)
  )
);

CREATE TABLE IF NOT EXISTS cash_explorer.price_anomaly (
  id text PRIMARY KEY,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE CASCADE,
  candidate_observation_id text NOT NULL REFERENCES cash_explorer.token_price_observation(id) ON UPDATE CASCADE ON DELETE CASCADE,
  baseline_observation_id text REFERENCES cash_explorer.token_price_observation(id) ON UPDATE CASCADE ON DELETE SET NULL,
  deviation_ratio numeric NOT NULL,
  threshold_ratio numeric NOT NULL DEFAULT 0.5,
  verification_status text NOT NULL DEFAULT 'pending',
  verified_observation_id text REFERENCES cash_explorer.token_price_observation(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT price_anomaly_ratio_nonnegative CHECK (deviation_ratio >= 0 AND threshold_ratio > 0),
  CONSTRAINT price_anomaly_status CHECK (verification_status IN ('pending', 'verified', 'rejected'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.explorer_checkpoint (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  checkpoint_kind text NOT NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  log_index integer NOT NULL DEFAULT -1,
  event_id text REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE SET NULL,
  finalized boolean NOT NULL DEFAULT false,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT explorer_checkpoint_key UNIQUE (chain_id, checkpoint_kind),
  CONSTRAINT explorer_checkpoint_log_index CHECK (log_index >= -1)
);

-- The price-observation link is added after both participating tables exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scanner_event_token_leg_price_observation_fkey'
      AND connamespace = 'cash_explorer'::regnamespace
  ) THEN
    ALTER TABLE cash_explorer.scanner_event_token_leg
      ADD CONSTRAINT scanner_event_token_leg_price_observation_fkey
      FOREIGN KEY (price_observation_id) REFERENCES cash_explorer.token_price_observation(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- Query-aligned indexes. The event ordering is the canonical global order:
-- timestamp DESC, chain_id ASC, block_number DESC, log_index DESC, id ASC.
CREATE INDEX IF NOT EXISTS scanner_event_global_keyset_idx
  ON cash_explorer.scanner_event (timestamp DESC, chain_id ASC, block_number DESC, log_index DESC, id ASC);
CREATE INDEX IF NOT EXISTS scanner_event_account_keyset_idx
  ON cash_explorer.scanner_event (account_id, timestamp DESC, chain_id ASC, block_number DESC, log_index DESC, id ASC);
CREATE INDEX IF NOT EXISTS scanner_event_type_keyset_idx
  ON cash_explorer.scanner_event (event_type, timestamp DESC, chain_id ASC, block_number DESC, log_index DESC, id ASC);
CREATE INDEX IF NOT EXISTS scanner_event_chain_tx_log_idx
  ON cash_explorer.scanner_event (chain_id, transaction_hash, log_index);
CREATE INDEX IF NOT EXISTS scanner_event_duplicate_idx
  ON cash_explorer.scanner_event (audit_duplicate_of_id) WHERE is_audit_duplicate;
CREATE INDEX IF NOT EXISTS scanner_event_token_leg_token_event_idx
  ON cash_explorer.scanner_event_token_leg (token_id, scanner_event_id, leg_index);
CREATE INDEX IF NOT EXISTS account_token_metric_token_idx ON cash_explorer.account_token_metric (token_id, account_id);
CREATE INDEX IF NOT EXISTS account_token_metric_spend_ranking_idx ON cash_explorer.account_token_metric (token_id, spend_usd DESC NULLS LAST, account_id ASC);
CREATE INDEX IF NOT EXISTS account_token_metric_balance_ranking_idx ON cash_explorer.account_token_metric (token_id, safe_balance_amount DESC, account_id ASC);
CREATE INDEX IF NOT EXISTS account_token_daily_metric_day_idx ON cash_explorer.account_token_daily_metric (day DESC, account_token_metric_id);
CREATE INDEX IF NOT EXISTS token_daily_metric_day_idx ON cash_explorer.token_daily_metric (token_id, day DESC);
CREATE INDEX IF NOT EXISTS token_price_observation_history_idx
  ON cash_explorer.token_price_observation (token_id, observed_at DESC, block_number DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS token_price_observation_finalized_idx
  ON cash_explorer.token_price_observation (token_id, source_type, block_number DESC, id ASC) WHERE is_finalized AND price_status = 'priced';
CREATE INDEX IF NOT EXISTS price_anomaly_pending_idx ON cash_explorer.price_anomaly (created_at ASC) WHERE verification_status = 'pending';
CREATE INDEX IF NOT EXISTS explorer_checkpoint_chain_kind_idx ON cash_explorer.explorer_checkpoint (chain_id, checkpoint_kind);

COMMIT;
