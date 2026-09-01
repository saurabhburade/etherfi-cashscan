-- Read-only post-apply validation. Run with psql; it makes no data changes.

-- Every canonical table is present and all FK constraints are validated.
SELECT c.relname AS table_name, con.conname AS foreign_key, con.convalidated
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'cash_explorer' AND con.contype = 'f'
ORDER BY c.relname, con.conname;

-- Confirm expected keyset and relationship-supporting indexes are valid.
SELECT i.relname AS index_name, ix.indisvalid, pg_get_indexdef(i.oid) AS definition
FROM pg_class i
JOIN pg_namespace n ON n.oid = i.relnamespace
JOIN pg_index ix ON ix.indexrelid = i.oid
WHERE n.nspname = 'cash_explorer'
  AND i.relname IN (
    'scanner_event_global_keyset_idx', 'scanner_event_account_keyset_idx',
    'scanner_event_type_keyset_idx', 'scanner_event_chain_tx_log_idx',
    'scanner_event_token_leg_token_event_idx', 'token_price_observation_history_idx',
    'token_price_observation_finalized_idx', 'explorer_checkpoint_chain_kind_idx'
  )
ORDER BY i.relname;

-- Primary-key and canonical event-ID duplicate audit. Both counts must be zero.
SELECT 'scanner_event_primary_key_duplicates' AS check_name, count(*) AS duplicate_groups
FROM (SELECT id FROM cash_explorer.scanner_event GROUP BY id HAVING count(*) > 1) d
UNION ALL
SELECT 'scanner_event_canonical_id_duplicates', count(*)
FROM (
  SELECT chain_id, transaction_hash, log_index
  FROM cash_explorer.scanner_event
  GROUP BY chain_id, transaction_hash, log_index HAVING count(*) > 1
) d;

-- Explain the canonical global keyset query. Bind the five cursor values with
-- psql variables (for example: -v ts="'2026-01-01T00:00:00Z'" -v chain=1 ...).
-- The predicate deliberately mirrors mixed DESC/ASC ordering.
EXPLAIN (COSTS false)
SELECT id, chain_id, transaction_hash, log_index, block_number, block_hash, timestamp, event_type
FROM cash_explorer.scanner_event
WHERE (timestamp < :'ts'::timestamptz)
   OR (timestamp = :'ts'::timestamptz AND chain_id > :chain::integer)
   OR (timestamp = :'ts'::timestamptz AND chain_id = :chain::integer AND block_number < :block::bigint)
   OR (timestamp = :'ts'::timestamptz AND chain_id = :chain::integer AND block_number = :block::bigint AND log_index < :log::integer)
   OR (timestamp = :'ts'::timestamptz AND chain_id = :chain::integer AND block_number = :block::bigint AND log_index = :log::integer AND id > :'id')
ORDER BY timestamp DESC, chain_id ASC, block_number DESC, log_index DESC, id ASC
LIMIT 100;
