-- Event-first Ether.fi Cash lending/accounting persistence.
-- Additive, idempotent, and deliberately free of data rewrites or resets.
BEGIN;

-- Account identities are normalized chain/address principals.  Existing
-- `account` rows remain the backwards-compatible Safe presentation record.
CREATE TABLE IF NOT EXISTS cash_explorer.account_identity (
  id text PRIMARY KEY,
  address text NOT NULL,
  identity_kind text NOT NULL DEFAULT 'safe',
  first_seen_block_number bigint,
  first_seen_block_hash text,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_identity_address_key UNIQUE (address),
  CONSTRAINT account_identity_id_key CHECK (id = address),
  CONSTRAINT account_identity_lowercase CHECK (address = lower(address)),
  CONSTRAINT account_identity_kind CHECK (identity_kind IN ('safe', 'owner', 'liquidator', 'counterparty'))
);

ALTER TABLE cash_explorer.account
  ADD COLUMN IF NOT EXISTS identity_id text REFERENCES cash_explorer.account_identity(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS account_identity_idx ON cash_explorer.account (identity_id) WHERE identity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_explorer.economic_action (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  account_id text REFERENCES cash_explorer.account(id) ON UPDATE CASCADE ON DELETE SET NULL,
  account_identity_id text REFERENCES cash_explorer.account_identity(id) ON UPDATE CASCADE ON DELETE SET NULL,
  action_type text NOT NULL,
  economic_key text NOT NULL,
  transaction_hash text,
  block_number bigint,
  block_hash text,
  occurred_at timestamptz,
  finality_status text NOT NULL DEFAULT 'observed',
  source_count integer NOT NULL DEFAULT 0,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT economic_action_key UNIQUE (chain_id, economic_key),
  CONSTRAINT economic_action_type CHECK (action_type IN ('deposit', 'spend', 'withdrawal', 'cashback', 'fee', 'other', 'supply', 'withdraw', 'borrow', 'repay', 'liquidation', 'collateral_enable', 'collateral_disable', 'reserve_registered', 'reserve_deregistered', 'position_manager_update', 'deficit')),
  CONSTRAINT economic_action_finality CHECK (finality_status IN ('observed', 'finalized', 'orphaned')),
  CONSTRAINT economic_action_source_count CHECK (source_count >= 0)
);

CREATE TABLE IF NOT EXISTS cash_explorer.lending_market (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  address text NOT NULL,
  market_kind text NOT NULL DEFAULT 'aave_v4',
  spoke_address text NOT NULL,
  gateway_address text,
  hub_address text,
  oracle_address text,
  price_provider_address text,
  registered_block_number bigint,
  registered_block_hash text,
  finalized_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lending_market_chain_address_key UNIQUE (chain_id, address),
  CONSTRAINT lending_market_id_key CHECK (id = chain_id::text || ':' || spoke_address),
  CONSTRAINT lending_market_lowercase CHECK (address = spoke_address AND address = lower(address) AND spoke_address = lower(spoke_address) AND gateway_address = lower(gateway_address) AND hub_address = lower(hub_address) AND oracle_address = lower(oracle_address)),
  CONSTRAINT lending_market_kind CHECK (market_kind IN ('aave_v4', 'etherfi_cash'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.lending_reserve (
  id text PRIMARY KEY,
  market_id text NOT NULL REFERENCES cash_explorer.lending_market(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  chain_id integer NOT NULL,
  asset_token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reserve_number numeric(78,0) NOT NULL,
  hub_asset_id numeric,
  is_active boolean NOT NULL DEFAULT true,
  registered_block_number bigint,
  registered_block_hash text,
  finalized_at timestamptz,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lending_reserve_market_asset_key UNIQUE (market_id, asset_token_id),
  CONSTRAINT lending_reserve_market_number_key UNIQUE (market_id, reserve_number),
  CONSTRAINT lending_reserve_id_key CHECK (id = market_id || ':' || reserve_number::text),
  CONSTRAINT lending_reserve_number_nonnegative CHECK (reserve_number >= 0)
);

CREATE TABLE IF NOT EXISTS cash_explorer.lending_event (
  id text PRIMARY KEY,
  chain_id integer NOT NULL,
  account_identity_id text REFERENCES cash_explorer.account_identity(id) ON UPDATE CASCADE ON DELETE SET NULL,
  economic_action_id text REFERENCES cash_explorer.economic_action(id) ON UPDATE CASCADE ON DELETE SET NULL,
  market_id text REFERENCES cash_explorer.lending_market(id) ON UPDATE CASCADE ON DELETE SET NULL,
  reserve_id text REFERENCES cash_explorer.lending_reserve(id) ON UPDATE CASCADE ON DELETE SET NULL,
  event_type text NOT NULL,
  source_kind text NOT NULL,
  source_contract_address text NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash text,
  occurred_at timestamptz NOT NULL,
  finality_status text NOT NULL DEFAULT 'observed',
  source_event_name text NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lending_event_source_key UNIQUE (chain_id, transaction_hash, log_index),
  CONSTRAINT lending_event_id_key CHECK (id = chain_id::text || ':' || transaction_hash || ':' || log_index::text),
  CONSTRAINT lending_event_lowercase CHECK (source_contract_address = lower(source_contract_address)),
  CONSTRAINT lending_event_type CHECK (event_type IN ('supply', 'withdraw', 'borrow', 'repay', 'liquidation', 'collateral_enable', 'collateral_disable', 'reserve_registered', 'reserve_deregistered', 'position_manager_update', 'deficit')),
  CONSTRAINT lending_event_source_kind CHECK (source_kind IN ('cash', 'gateway', 'spoke')),
  CONSTRAINT lending_event_finality CHECK (finality_status IN ('observed', 'finalized', 'orphaned'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.economic_action_source (
  id text PRIMARY KEY,
  economic_action_id text NOT NULL REFERENCES cash_explorer.economic_action(id) ON UPDATE CASCADE ON DELETE CASCADE,
  lending_event_id text UNIQUE REFERENCES cash_explorer.lending_event(id) ON UPDATE CASCADE ON DELETE CASCADE,
  scanner_event_id text UNIQUE REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_role text NOT NULL DEFAULT 'state_delta',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT economic_action_source_action_lending_key UNIQUE (economic_action_id, lending_event_id),
  CONSTRAINT economic_action_source_kind CHECK (source_kind IN ('cash', 'gateway', 'spoke', 'scanner')),
  CONSTRAINT economic_action_source_role CHECK (source_role IN ('primary', 'corroborating', 'settlement', 'state_delta')),
  CONSTRAINT economic_action_source_exactly_one CHECK (num_nonnulls(lending_event_id, scanner_event_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS economic_action_source_action_scanner_key
  ON cash_explorer.economic_action_source (economic_action_id, scanner_event_id) WHERE scanner_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_explorer.lending_event_leg (
  id text PRIMARY KEY,
  lending_event_id text NOT NULL REFERENCES cash_explorer.lending_event(id) ON UPDATE CASCADE ON DELETE CASCADE,
  reserve_id text REFERENCES cash_explorer.lending_reserve(id) ON UPDATE CASCADE ON DELETE SET NULL,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  leg_index integer NOT NULL,
  balance_kind text NOT NULL,
  leg_type text NOT NULL,
  direction text NOT NULL,
  raw_amount numeric NOT NULL CHECK (raw_amount >= 0),
  supplied_shares_delta numeric NOT NULL DEFAULT 0,
  drawn_shares_delta numeric NOT NULL DEFAULT 0,
  premium_shares_delta numeric NOT NULL DEFAULT 0,
  premium_offset_ray_delta numeric NOT NULL DEFAULT 0,
  amount_usd numeric,
  valuation_status text NOT NULL DEFAULT 'unpriced',
  price_observation_id text REFERENCES cash_explorer.token_price_observation(id) ON UPDATE CASCADE ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lending_event_leg_key UNIQUE (lending_event_id, leg_index),
  CONSTRAINT lending_event_leg_index CHECK (leg_index >= 0),
  CONSTRAINT lending_event_leg_kind CHECK (balance_kind IN ('wallet', 'supplied', 'gross_assets', 'protocol_debt', 'collateral')),
  CONSTRAINT lending_event_leg_type CHECK (leg_type IN ('supply', 'withdraw', 'borrow', 'repay', 'debt_restored', 'collateral_seized', 'liquidation_fee', 'deficit', 'reserve_mapping', 'collateral_toggle', 'asset', 'supplied_shares', 'drawn_shares', 'premium_shares', 'premium_offset_ray', 'collateral')),
  CONSTRAINT lending_event_leg_direction CHECK (direction IN ('increase', 'decrease', 'neutral')),
  CONSTRAINT lending_event_leg_valuation CHECK ((valuation_status = 'priced' AND amount_usd IS NOT NULL) OR (valuation_status <> 'priced' AND amount_usd IS NULL)),
  CONSTRAINT lending_event_leg_status CHECK (valuation_status IN ('priced', 'unpriced', 'pending', 'anomalous'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.lending_position (
  id text PRIMARY KEY,
  account_identity_id text NOT NULL REFERENCES cash_explorer.account_identity(id) ON UPDATE CASCADE ON DELETE CASCADE,
  reserve_id text NOT NULL REFERENCES cash_explorer.lending_reserve(id) ON UPDATE CASCADE ON DELETE CASCADE,
  chain_id integer NOT NULL,
  wallet_balance numeric NOT NULL DEFAULT 0,
  supplied_balance numeric NOT NULL DEFAULT 0,
  supplied_shares numeric NOT NULL DEFAULT 0,
  drawn_shares numeric NOT NULL DEFAULT 0,
  premium_shares numeric NOT NULL DEFAULT 0,
  premium_offset_ray numeric NOT NULL DEFAULT 0,
  using_as_collateral boolean NOT NULL DEFAULT false,
  gross_assets numeric NOT NULL DEFAULT 0,
  protocol_debt numeric NOT NULL DEFAULT 0,
  wallet_balance_usd numeric,
  supplied_balance_usd numeric,
  gross_assets_usd numeric,
  protocol_debt_usd numeric,
  net_worth_usd numeric,
  valuation_status text NOT NULL DEFAULT 'unpriced',
  state_status text NOT NULL DEFAULT 'unavailable',
  state_source text NOT NULL DEFAULT 'event',
  finality_status text NOT NULL DEFAULT 'observed',
  price_observation_id text REFERENCES cash_explorer.token_price_observation(id) ON UPDATE CASCADE ON DELETE SET NULL,
  state_block_number bigint,
  state_block_hash text,
  state_observed_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lending_position_key UNIQUE (account_identity_id, reserve_id),
  CONSTRAINT lending_position_values CHECK (wallet_balance >= 0 AND supplied_balance >= 0 AND supplied_shares >= 0 AND drawn_shares >= 0 AND premium_shares >= 0 AND gross_assets >= 0 AND protocol_debt >= 0),
  CONSTRAINT lending_position_valuation CHECK ((valuation_status = 'priced' AND gross_assets_usd IS NOT NULL AND protocol_debt_usd IS NOT NULL AND net_worth_usd IS NOT NULL) OR (valuation_status <> 'priced' AND wallet_balance_usd IS NULL AND supplied_balance_usd IS NULL AND gross_assets_usd IS NULL AND protocol_debt_usd IS NULL AND net_worth_usd IS NULL)),
  CONSTRAINT lending_position_status CHECK (valuation_status IN ('priced', 'unpriced', 'pending', 'anomalous'))
  ,CONSTRAINT lending_position_state_status CHECK (state_status IN ('rpc_exact', 'event_derived', 'stale', 'partial', 'unavailable'))
  ,CONSTRAINT lending_position_state_source CHECK (state_source IN ('event', 'multicall', 'archive_multicall'))
  ,CONSTRAINT lending_position_finality CHECK (finality_status IN ('observed', 'finalized', 'orphaned'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.lending_position_snapshot (
  id text PRIMARY KEY,
  lending_position_id text NOT NULL REFERENCES cash_explorer.lending_position(id) ON UPDATE CASCADE ON DELETE CASCADE,
  account_identity_id text NOT NULL REFERENCES cash_explorer.account_identity(id) ON UPDATE CASCADE ON DELETE CASCADE,
  reserve_id text NOT NULL REFERENCES cash_explorer.lending_reserve(id) ON UPDATE CASCADE ON DELETE CASCADE,
  chain_id integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  snapshot_kind text NOT NULL,
  wallet_balance numeric NOT NULL DEFAULT 0,
  supplied_balance numeric NOT NULL DEFAULT 0,
  supplied_shares numeric NOT NULL DEFAULT 0,
  drawn_shares numeric NOT NULL DEFAULT 0,
  premium_shares numeric NOT NULL DEFAULT 0,
  premium_offset_ray numeric NOT NULL DEFAULT 0,
  using_as_collateral boolean NOT NULL DEFAULT false,
  gross_assets numeric NOT NULL DEFAULT 0,
  protocol_debt numeric NOT NULL DEFAULT 0,
  wallet_balance_usd numeric,
  supplied_balance_usd numeric,
  gross_assets_usd numeric,
  protocol_debt_usd numeric,
  net_worth_usd numeric,
  valuation_status text NOT NULL DEFAULT 'unpriced',
  state_status text NOT NULL DEFAULT 'unavailable',
  state_source text NOT NULL DEFAULT 'event',
  finality_status text NOT NULL DEFAULT 'observed',
  price_observation_id text REFERENCES cash_explorer.token_price_observation(id) ON UPDATE CASCADE ON DELETE SET NULL,
  observed_at timestamptz NOT NULL,
  finalized_at timestamptz,
  CONSTRAINT lending_position_snapshot_key UNIQUE (lending_position_id, block_number, snapshot_kind),
  CONSTRAINT lending_position_snapshot_values CHECK (wallet_balance >= 0 AND supplied_balance >= 0 AND supplied_shares >= 0 AND drawn_shares >= 0 AND premium_shares >= 0 AND gross_assets >= 0 AND protocol_debt >= 0),
  CONSTRAINT lending_position_snapshot_kind CHECK (snapshot_kind IN ('event', 'checkpoint', 'refresh')),
  CONSTRAINT lending_position_snapshot_valuation CHECK ((valuation_status = 'priced' AND gross_assets_usd IS NOT NULL AND protocol_debt_usd IS NOT NULL AND net_worth_usd IS NOT NULL) OR (valuation_status <> 'priced' AND wallet_balance_usd IS NULL AND supplied_balance_usd IS NULL AND gross_assets_usd IS NULL AND protocol_debt_usd IS NULL AND net_worth_usd IS NULL)),
  CONSTRAINT lending_position_snapshot_status CHECK (valuation_status IN ('priced', 'unpriced', 'pending', 'anomalous'))
  ,CONSTRAINT lending_position_snapshot_state_status CHECK (state_status IN ('rpc_exact', 'event_derived', 'stale', 'partial', 'unavailable'))
  ,CONSTRAINT lending_position_snapshot_state_source CHECK (state_source IN ('event', 'multicall', 'archive_multicall'))
  ,CONSTRAINT lending_position_snapshot_finality CHECK (finality_status IN ('observed', 'finalized', 'orphaned'))
);

CREATE TABLE IF NOT EXISTS cash_explorer.lending_account_snapshot (
  id text PRIMARY KEY,
  account_identity_id text NOT NULL REFERENCES cash_explorer.account_identity(id) ON UPDATE CASCADE ON DELETE CASCADE,
  chain_id integer NOT NULL,
  market_id text REFERENCES cash_explorer.lending_market(id) ON UPDATE CASCADE ON DELETE SET NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  snapshot_kind text NOT NULL,
  wallet_balance_usd numeric,
  supplied_balance_usd numeric,
  gross_assets_usd numeric,
  protocol_debt_usd numeric,
  net_worth_usd numeric,
  risk_premium_ray numeric,
  total_collateral_value_raw numeric,
  total_debt_value_ray_raw numeric,
  health_factor_e18 numeric,
  avg_collateral_factor_e18 numeric,
  available_borrow_usd numeric,
  active_collateral_count integer NOT NULL DEFAULT 0,
  borrow_count integer NOT NULL DEFAULT 0,
  valuation_status text NOT NULL DEFAULT 'unpriced',
  state_status text NOT NULL DEFAULT 'unavailable',
  state_source text NOT NULL DEFAULT 'event',
  finality_status text NOT NULL DEFAULT 'observed',
  observed_at timestamptz NOT NULL,
  finalized_at timestamptz,
  CONSTRAINT lending_account_snapshot_key UNIQUE (account_identity_id, market_id, block_number, snapshot_kind),
  CONSTRAINT lending_account_snapshot_kind CHECK (snapshot_kind IN ('event', 'checkpoint', 'refresh')),
  CONSTRAINT lending_account_snapshot_valuation CHECK ((valuation_status = 'priced' AND gross_assets_usd IS NOT NULL AND protocol_debt_usd IS NOT NULL AND net_worth_usd IS NOT NULL) OR (valuation_status <> 'priced' AND wallet_balance_usd IS NULL AND supplied_balance_usd IS NULL AND gross_assets_usd IS NULL AND protocol_debt_usd IS NULL AND net_worth_usd IS NULL)),
  CONSTRAINT lending_account_snapshot_status CHECK (valuation_status IN ('priced', 'unpriced', 'pending', 'anomalous')),
  CONSTRAINT lending_account_snapshot_state_status CHECK (state_status IN ('rpc_exact', 'event_derived', 'stale', 'partial', 'unavailable')),
  CONSTRAINT lending_account_snapshot_state_source CHECK (state_source IN ('event', 'multicall', 'archive_multicall')),
  CONSTRAINT lending_account_snapshot_finality CHECK (finality_status IN ('observed', 'finalized', 'orphaned')),
  CONSTRAINT lending_account_snapshot_counts CHECK (active_collateral_count >= 0 AND borrow_count >= 0)
);

ALTER TABLE cash_explorer.account_token_event
  ADD COLUMN IF NOT EXISTS economic_action_id text REFERENCES cash_explorer.economic_action(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE cash_explorer.account_token_metric
  ADD COLUMN IF NOT EXISTS wallet_balance numeric,
  ADD COLUMN IF NOT EXISTS supplied_balance numeric,
  ADD COLUMN IF NOT EXISTS gross_assets numeric,
  ADD COLUMN IF NOT EXISTS protocol_debt numeric,
  ADD COLUMN IF NOT EXISTS net_worth numeric,
  ADD COLUMN IF NOT EXISTS wallet_balance_usd numeric,
  ADD COLUMN IF NOT EXISTS supplied_balance_usd numeric,
  ADD COLUMN IF NOT EXISTS gross_assets_usd numeric,
  ADD COLUMN IF NOT EXISTS protocol_debt_usd numeric,
  ADD COLUMN IF NOT EXISTS net_worth_usd numeric,
  ADD COLUMN IF NOT EXISTS lending_snapshot_block_number bigint,
  ADD COLUMN IF NOT EXISTS lending_snapshot_block_hash text,
  ADD COLUMN IF NOT EXISTS lending_snapshot_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lending_snapshot_status text NOT NULL DEFAULT 'not_observed';
ALTER TABLE cash_explorer.account_metric
  ADD COLUMN IF NOT EXISTS wallet_balance_usd numeric,
  ADD COLUMN IF NOT EXISTS supplied_balance_usd numeric,
  ADD COLUMN IF NOT EXISTS gross_assets_usd numeric,
  ADD COLUMN IF NOT EXISTS protocol_debt_usd numeric,
  ADD COLUMN IF NOT EXISTS health_factor_e18 numeric,
  ADD COLUMN IF NOT EXISTS lending_snapshot_block_number bigint,
  ADD COLUMN IF NOT EXISTS lending_snapshot_block_hash text,
  ADD COLUMN IF NOT EXISTS lending_snapshot_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lending_snapshot_status text NOT NULL DEFAULT 'not_observed';

-- `account_daily_metric` used to contain an optional token FK.  Retain that
-- legacy column for backfill readers, but make all new account-day rows
-- account-only; token day rows belong in account_token_daily_metric.
-- The token column cannot be constrained until this additive copy has been
-- reviewed and run by an operator.  This view is the safe compatibility path:
-- it exposes every legacy token row for an idempotent, auditable backfill.
CREATE OR REPLACE VIEW cash_explorer.account_daily_metric_legacy_token_rows AS
  SELECT * FROM cash_explorer.account_daily_metric WHERE token_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_daily_metric_account_day_key
  ON cash_explorer.account_daily_metric (account_id, day) WHERE token_id IS NULL;

-- Aave oracle and current PriceProvider are first-class price provenance.
ALTER TABLE cash_explorer.token_price_source
  DROP CONSTRAINT IF EXISTS token_price_source_type;
ALTER TABLE cash_explorer.token_price_source
  ADD CONSTRAINT token_price_source_type CHECK (source_type IN ('event_implied', 'chainlink_historical', 'price_provider_historical', 'aave_oracle_historical', 'aave_oracle_current', 'price_provider_current', 'current_cache'));
ALTER TABLE cash_explorer.token_price_observation
  DROP CONSTRAINT IF EXISTS token_price_observation_source_type;
ALTER TABLE cash_explorer.token_price_observation
  ADD CONSTRAINT token_price_observation_source_type CHECK (source_type IN ('event_implied', 'chainlink_historical', 'price_provider_historical', 'aave_oracle_historical', 'aave_oracle_current', 'price_provider_current', 'current_cache'));

CREATE INDEX IF NOT EXISTS economic_action_account_time_idx ON cash_explorer.economic_action (account_identity_id, occurred_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS economic_action_finalized_idx ON cash_explorer.economic_action (chain_id, block_number DESC, id ASC) WHERE finality_status = 'finalized';
CREATE INDEX IF NOT EXISTS lending_event_account_keyset_idx ON cash_explorer.lending_event (account_identity_id, occurred_at DESC, block_number DESC, log_index DESC, id ASC);
CREATE INDEX IF NOT EXISTS lending_event_reserve_finalized_idx ON cash_explorer.lending_event (reserve_id, block_number DESC, log_index DESC, id ASC) WHERE finality_status = 'finalized';
CREATE INDEX IF NOT EXISTS lending_event_leg_token_idx ON cash_explorer.lending_event_leg (token_id, lending_event_id, leg_index);
CREATE INDEX IF NOT EXISTS lending_position_net_worth_ranking_idx ON cash_explorer.lending_position (net_worth_usd DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS account_metric_net_worth_ranking_idx ON cash_explorer.account_metric (net_worth_usd DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS lending_position_account_idx ON cash_explorer.lending_position (account_identity_id, gross_assets_usd DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS lending_position_snapshot_history_idx ON cash_explorer.lending_position_snapshot (lending_position_id, block_number DESC, id ASC);
CREATE INDEX IF NOT EXISTS lending_account_snapshot_history_idx ON cash_explorer.lending_account_snapshot (account_identity_id, block_number DESC, id ASC);
CREATE INDEX IF NOT EXISTS account_token_event_economic_action_idx ON cash_explorer.account_token_event (economic_action_id) WHERE economic_action_id IS NOT NULL;

-- Every chain-scoped lending child is tied to a parent on both its opaque ID
-- and chain.  The supporting unique indexes are additive and preserve the
-- existing single-column primary keys used by legacy queries.
CREATE UNIQUE INDEX IF NOT EXISTS lending_market_id_chain_key ON cash_explorer.lending_market (id, chain_id);
CREATE UNIQUE INDEX IF NOT EXISTS lending_reserve_id_chain_key ON cash_explorer.lending_reserve (id, chain_id);
CREATE UNIQUE INDEX IF NOT EXISTS token_id_chain_key ON cash_explorer.token (id, chain_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_id_chain_key ON cash_explorer.account (id, chain_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'economic_action_account_chain_fkey' AND connamespace = 'cash_explorer'::regnamespace) THEN
    ALTER TABLE cash_explorer.economic_action ADD CONSTRAINT economic_action_account_chain_fkey FOREIGN KEY (account_id, chain_id) REFERENCES cash_explorer.account (id, chain_id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lending_reserve_asset_token_chain_fkey' AND connamespace = 'cash_explorer'::regnamespace) THEN
    ALTER TABLE cash_explorer.lending_reserve ADD CONSTRAINT lending_reserve_asset_token_chain_fkey FOREIGN KEY (asset_token_id, chain_id) REFERENCES cash_explorer.token (id, chain_id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lending_event_market_chain_fkey' AND connamespace = 'cash_explorer'::regnamespace) THEN
    ALTER TABLE cash_explorer.lending_event ADD CONSTRAINT lending_event_market_chain_fkey FOREIGN KEY (market_id, chain_id) REFERENCES cash_explorer.lending_market (id, chain_id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lending_event_reserve_chain_fkey' AND connamespace = 'cash_explorer'::regnamespace) THEN
    ALTER TABLE cash_explorer.lending_event ADD CONSTRAINT lending_event_reserve_chain_fkey FOREIGN KEY (reserve_id, chain_id) REFERENCES cash_explorer.lending_reserve (id, chain_id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lending_position_reserve_chain_fkey' AND connamespace = 'cash_explorer'::regnamespace) THEN
    ALTER TABLE cash_explorer.lending_position ADD CONSTRAINT lending_position_reserve_chain_fkey FOREIGN KEY (reserve_id, chain_id) REFERENCES cash_explorer.lending_reserve (id, chain_id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lending_account_snapshot_market_chain_fkey' AND connamespace = 'cash_explorer'::regnamespace) THEN
    ALTER TABLE cash_explorer.lending_account_snapshot ADD CONSTRAINT lending_account_snapshot_market_chain_fkey FOREIGN KEY (market_id, chain_id) REFERENCES cash_explorer.lending_market (id, chain_id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN cash_explorer.lending_position.wallet_balance IS 'Observed wallet units; never repurposes legacy current_balance_amount.';
COMMENT ON COLUMN cash_explorer.lending_position.supplied_balance IS 'Observed supplied units.';
COMMENT ON COLUMN cash_explorer.lending_position.gross_assets IS 'Wallet plus supplied asset units only when compatible for the reserve.';
COMMENT ON COLUMN cash_explorer.lending_position.protocol_debt IS 'Authoritative accrued protocol debt units at state_block_number.';
COMMENT ON COLUMN cash_explorer.lending_position.net_worth_usd IS 'Gross assets USD minus protocol debt USD; NULL whenever the complete valuation is unavailable.';
COMMENT ON COLUMN cash_explorer.lending_account_snapshot.risk_premium_ray IS 'Raw Aave V4 risk premium in ray units; not normalized USD.';
COMMENT ON COLUMN cash_explorer.lending_account_snapshot.total_collateral_value_raw IS 'Raw Aave V4 aggregate collateral value; normalized USD remains NULL until scale and pricing are verified.';
COMMENT ON COLUMN cash_explorer.lending_account_snapshot.total_debt_value_ray_raw IS 'Raw Aave V4 aggregate debt value in ray units; normalized USD remains NULL until scale and pricing are verified.';

COMMIT;
