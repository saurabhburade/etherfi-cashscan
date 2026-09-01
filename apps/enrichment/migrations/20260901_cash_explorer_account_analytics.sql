-- Normalized account analytics layered on the canonical scanner event/leg ledger.
-- Additive and idempotent: no Envio table is changed or read by this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS cash_explorer.account_token_event (
  id text PRIMARY KEY,
  scanner_event_token_leg_id text NOT NULL UNIQUE REFERENCES cash_explorer.scanner_event_token_leg(id) ON UPDATE CASCADE ON DELETE CASCADE,
  scanner_event_id text NOT NULL REFERENCES cash_explorer.scanner_event(id) ON UPDATE CASCADE ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES cash_explorer.account(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token_id text NOT NULL REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  chain_id integer NOT NULL,
  safe_address text NOT NULL,
  token_address text NOT NULL,
  category text NOT NULL,
  direction text NOT NULL,
  funding_mode text,
  status text NOT NULL,
  amount_raw numeric NOT NULL CHECK (amount_raw >= 0),
  token_decimals integer CHECK (token_decimals IS NULL OR token_decimals BETWEEN 0 AND 255),
  price_usd_e18 numeric,
  amount_usd numeric,
  valuation_status text NOT NULL,
  valuation_source text,
  valuation_observed_at timestamptz,
  valuation_basis text NOT NULL DEFAULT 'event_time',
  timestamp timestamptz NOT NULL,
  block_number bigint NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  leg_index integer NOT NULL,
  source_event_name text NOT NULL,
  canonical_movement_key text NOT NULL UNIQUE,
  reconciliation_status text NOT NULL DEFAULT 'canonical_leg',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_token_event_category CHECK (category IN ('deposit','spend','withdrawal','cashback','borrow','repayment','fee','other')),
  CONSTRAINT account_token_event_direction CHECK (direction IN ('in','out','neutral')),
  CONSTRAINT account_token_event_funding_mode CHECK (funding_mode IS NULL OR funding_mode IN ('credit','debit')),
  CONSTRAINT account_token_event_status CHECK (status IN ('pending','completed','cancelled')),
  CONSTRAINT account_token_event_valuation_status CHECK (valuation_status IN ('priced','unpriced','pending','anomalous')),
  CONSTRAINT account_token_event_priced_values CHECK (
    (valuation_status = 'priced' AND amount_usd IS NOT NULL)
    OR (valuation_status <> 'priced' AND amount_usd IS NULL)
  ),
  CONSTRAINT account_token_event_spend_mode_only CHECK (funding_mode IS NULL OR category = 'spend'),
  CONSTRAINT account_token_event_category_direction CHECK (
    (category IN ('deposit','cashback','borrow') AND direction = 'in')
    OR (category IN ('spend','withdrawal','repayment','fee') AND direction = 'out')
    OR category = 'other'
  )
);

CREATE INDEX IF NOT EXISTS account_token_event_account_cursor_idx
  ON cash_explorer.account_token_event (account_id, timestamp DESC, block_number DESC, log_index DESC, leg_index DESC, id ASC);
CREATE INDEX IF NOT EXISTS account_token_event_token_cursor_idx
  ON cash_explorer.account_token_event (token_id, timestamp DESC, block_number DESC, log_index DESC, leg_index DESC, id ASC);
CREATE INDEX IF NOT EXISTS account_token_event_category_cursor_idx
  ON cash_explorer.account_token_event (category, timestamp DESC, chain_id ASC, block_number DESC, log_index DESC, id ASC);
CREATE INDEX IF NOT EXISTS account_token_event_tx_reconciliation_idx
  ON cash_explorer.account_token_event (chain_id, transaction_hash, account_id, token_id, category, leg_index);

ALTER TABLE cash_explorer.account_token_metric
  ADD COLUMN IF NOT EXISTS deposit_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposited_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposited_usd numeric,
  ADD COLUMN IF NOT EXISTS spent_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spent_usd numeric,
  ADD COLUMN IF NOT EXISTS credit_spend_usd numeric,
  ADD COLUMN IF NOT EXISTS debit_spend_usd numeric,
  ADD COLUMN IF NOT EXISTS withdrawal_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdrawn_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdrawn_usd numeric,
  ADD COLUMN IF NOT EXISTS borrowed_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS borrowed_usd numeric,
  ADD COLUMN IF NOT EXISTS repaid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repaid_usd numeric,
  ADD COLUMN IF NOT EXISTS outstanding_debt_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_debt_usd numeric,
  ADD COLUMN IF NOT EXISTS outstanding_debt_status text NOT NULL DEFAULT 'event_ledger_only',
  ADD COLUMN IF NOT EXISTS other_inflow_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_outflow_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_balance_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_balance_usd numeric,
  ADD COLUMN IF NOT EXISTS current_balance_valuation_status text NOT NULL DEFAULT 'unpriced',
  ADD COLUMN IF NOT EXISTS current_balance_price_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS flow_valuation_basis text NOT NULL DEFAULT 'event_time_usd',
  ADD COLUMN IF NOT EXISTS balance_valuation_basis text NOT NULL DEFAULT 'latest_indexed_price',
  ADD COLUMN IF NOT EXISTS first_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- Overall amount_usd remains NULL when the complete row is not priced, while
-- independently complete category totals may still be shown with their own
-- event-time provenance.
ALTER TABLE cash_explorer.account_token_metric
  DROP CONSTRAINT IF EXISTS account_token_metric_unpriced_usd_is_null;
ALTER TABLE cash_explorer.account_token_metric
  ADD CONSTRAINT account_token_metric_unpriced_usd_is_null CHECK (usd_status = 'priced' OR amount_usd IS NULL);

CREATE TABLE IF NOT EXISTS cash_explorer.account_metric (
  id text PRIMARY KEY REFERENCES cash_explorer.account(id) ON UPDATE CASCADE ON DELETE CASCADE,
  chain_id integer NOT NULL,
  safe_address text NOT NULL,
  token_count integer NOT NULL DEFAULT 0,
  transaction_count bigint NOT NULL DEFAULT 0,
  lifetime_deposited_usd numeric,
  lifetime_spent_usd numeric,
  lifetime_withdrawn_usd numeric,
  lifetime_cashback_usd numeric,
  credit_spend_usd numeric,
  debit_spend_usd numeric,
  borrowed_usd numeric,
  repaid_usd numeric,
  event_ledger_outstanding_debt_usd numeric,
  debt_status text NOT NULL DEFAULT 'event_ledger_only',
  current_balance_usd numeric,
  net_worth_usd numeric,
  unpriced_position_count integer NOT NULL DEFAULT 0,
  first_activity_at timestamptz,
  last_activity_at timestamptz,
  balance_valuation_basis text NOT NULL DEFAULT 'latest_indexed_price',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_metric_chain_safe_key UNIQUE (chain_id,safe_address),
  CONSTRAINT account_metric_nonnegative_counts CHECK (token_count >= 0 AND transaction_count >= 0 AND unpriced_position_count >= 0),
  CONSTRAINT account_metric_net_worth_requires_balance CHECK (net_worth_usd IS NULL OR current_balance_usd IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS account_metric_spend_ranking_idx
  ON cash_explorer.account_metric (lifetime_spent_usd DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS account_metric_balance_ranking_idx
  ON cash_explorer.account_metric (current_balance_usd DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS account_metric_last_activity_idx
  ON cash_explorer.account_metric (last_activity_at DESC NULLS LAST, id ASC);
CREATE INDEX IF NOT EXISTS account_token_metric_account_balance_idx
  ON cash_explorer.account_token_metric (account_id, current_balance_usd DESC NULLS LAST, id ASC);

CREATE TABLE IF NOT EXISTS cash_explorer.account_daily_metric (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES cash_explorer.account(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token_id text REFERENCES cash_explorer.token(id) ON UPDATE CASCADE ON DELETE CASCADE,
  day date NOT NULL,
  chain_id integer NOT NULL,
  safe_address text NOT NULL,
  deposited_usd numeric,
  spent_usd numeric,
  credit_spend_usd numeric,
  debit_spend_usd numeric,
  withdrawn_usd numeric,
  cashback_usd numeric,
  borrowed_usd numeric,
  repaid_usd numeric,
  other_inflow_usd numeric,
  other_outflow_usd numeric,
  closing_balance_usd numeric,
  closing_balance_status text NOT NULL DEFAULT 'not_reconstructed',
  closing_balance_basis text NOT NULL DEFAULT 'not_derived_from_flows',
  transaction_count bigint NOT NULL DEFAULT 0,
  pricing_coverage_ratio numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_daily_metric_key UNIQUE NULLS NOT DISTINCT (day,account_id,token_id),
  CONSTRAINT account_daily_metric_closing_status CHECK (closing_balance_status IN ('priced','partial','unpriced','not_reconstructed')),
  CONSTRAINT account_daily_metric_pricing_ratio CHECK (pricing_coverage_ratio BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS account_daily_metric_account_day_idx
  ON cash_explorer.account_daily_metric (account_id, day DESC, token_id NULLS FIRST);

COMMENT ON TABLE cash_explorer.account_token_event IS
  'One mutually-exclusive classification per canonical scanner token leg. A leg cannot be both spend and withdrawal.';
COMMENT ON COLUMN cash_explorer.account_token_metric.outstanding_debt_usd IS
  'Event-ledger borrow minus repayment only; not authoritative accrued protocol debt.';
COMMENT ON COLUMN cash_explorer.account_token_metric.current_balance_usd IS
  'Current Safe token balance multiplied by the latest indexed token price; never reconstructed from historical USD flows.';
COMMENT ON COLUMN cash_explorer.account_daily_metric.closing_balance_usd IS
  'NULL until an independently observed historical balance snapshot exists; never inferred from USD cash flows.';

COMMIT;
