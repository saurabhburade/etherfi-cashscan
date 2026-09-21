-- Online indexes for the AccountMetric list query used by Account Explorer.
--
-- The default query orders by currentBalanceUsd DESC NULLS LAST, id ASC.
-- The chain-filtered query adds `WHERE chainId = <value>` but keeps the same
-- ordering. Existing single-column and schema-declared compound indexes do
-- not encode both the NULLS LAST placement and the id tie-breaker, so they
-- cannot provide this order directly.
--
-- This file intentionally contains no BEGIN/COMMIT. CREATE INDEX CONCURRENTLY
-- must run outside a transaction and permits Envio to keep writing while the
-- indexes build. Execute it directly with psql and ON_ERROR_STOP enabled.
-- It only adds indexes; it does not reset, delete, or rewrite entity data.
-- If a build is interrupted, inspect the validity query below before retrying:
-- PostgreSQL can retain an invalid index, and IF NOT EXISTS will not repair it.

-- Covers the unfiltered AccountMetric list query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AccountMetric_currentBalanceUsd_desc_nulls_last_id_asc"
  ON "etherfi_enriched"."AccountMetric" ("currentBalanceUsd" DESC NULLS LAST, "id" ASC);

-- Covers AccountMetric WHERE chainId = <value> with the same ordering.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AccountMetric_chainId_currentBalanceUsd_desc_nulls_last_id_asc"
  ON "etherfi_enriched"."AccountMetric"
    ("chainId" ASC, "currentBalanceUsd" DESC NULLS LAST, "id" ASC);

-- Write-amplification tradeoff: AccountMetric inserts and updates that touch
-- these keys maintain both indexes. This is the minimal pair for the two
-- observed query shapes; do not add alternate sort indexes without query
-- evidence because each additional index increases write and storage cost.

-- Read-only validity and definition check. Expect two rows with indisvalid and
-- indisready both true. Confirm pg_get_indexdef matches the two CREATE INDEX
-- statements above, including DESC NULLS LAST and the id ASC tie-breaker.
-- SELECT i.relname AS index_name,
--        ix.indisvalid,
--        ix.indisready,
--        pg_get_indexdef(i.oid) AS definition
-- FROM pg_class AS i
-- JOIN pg_namespace AS n ON n.oid = i.relnamespace
-- JOIN pg_index AS ix ON ix.indexrelid = i.oid
-- WHERE n.nspname = 'etherfi_enriched'
--   AND i.relname IN (
--     'AccountMetric_currentBalanceUsd_desc_nulls_last_id_asc',
--     'AccountMetric_chainId_currentBalanceUsd_desc_nulls_last_id_asc'
--   )
-- ORDER BY i.relname;

-- Read-only EXPLAIN guidance for the default query. Use the same projection,
-- limit, and offset as the production request when comparing plans.
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT "id", "chainId", "currentBalanceUsd"
-- FROM "etherfi_enriched"."AccountMetric"
-- ORDER BY "currentBalanceUsd" DESC NULLS LAST, "id" ASC
-- LIMIT 101 OFFSET 0;

-- Read-only EXPLAIN guidance for the chain-filtered query. Replace 1 with an
-- actual chain id present in the production data.
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT "id", "chainId", "currentBalanceUsd"
-- FROM "etherfi_enriched"."AccountMetric"
-- WHERE "chainId" = 1
-- ORDER BY "currentBalanceUsd" DESC NULLS LAST, "id" ASC
-- LIMIT 101 OFFSET 0;
