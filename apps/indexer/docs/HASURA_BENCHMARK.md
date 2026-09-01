# Hasura GraphQL benchmark

`scripts/benchmark-hasura-graphql.mjs` is a reproducible, read-only latency benchmark for the Cash UI's Hasura operations. It sends GraphQL POST requests only; it does not contact Postgres, start Envio, or modify indexed data.

Set the endpoint through `ENVIO_GRAPHQL_URL` (or `HASURA_GRAPHQL_URL`) and, where needed, the secret through `ENVIO_HASURA_ADMIN_SECRET` (or `HASURA_GRAPHQL_ADMIN_SECRET`). Secrets are used only as a request header and are never printed.

```sh
ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql \
node apps/indexer/scripts/benchmark-hasura-graphql.mjs --warmup 1 --repeats 10 \
  --max-p95-ms 250 --max-max-ms 500 --max-bytes 2000000
```

The output gives each operation's p50, p95, max latency, largest response size, GraphQL/network failures, and a per-field row/count summary. A threshold breach or query error returns exit code 1. Invalid arguments return 2. `--report-only` always returns 0, which makes it useful for collecting a baseline from a partially deployed schema without weakening normal CI threshold checks.

To include the dependent spend-detail operation, provide real event IDs (normally selected from a prior events report) without putting them on the command line:

```sh
BENCHMARK_SPEND_DETAIL_IDS=id-1,id-2 node apps/indexer/scripts/benchmark-hasura-graphql.mjs
```

For a low-impact availability check, run only the health operation:

```sh
node apps/indexer/scripts/benchmark-hasura-graphql.mjs --only Health --repeats 1 --report-only
```

The token analytics page reads the materialized `TokenAnalyticsMetric` entity.
Benchmark that replacement query with:

```sh
ENVIO_HASURA_ADMIN_SECRET=testing \
BENCHMARK_REPEATS=3 \
node apps/indexer/scripts/benchmark-token-analytics.mjs
```

`benchmark-token-analytics.mjs` measures the one bounded metric query, including
its response size. It is read-only. Use `BENCHMARK_CHAIN_ID` to reproduce a
network-filtered page.

Operations mirror `apps/web/lib/envio.ts`, including core data, token analytics state, cash history, rankings, configuration, daily metrics, tokens, hourly/bucket metrics, FX rates, spend-related aggregates, and state queries. The events operation uses the shared-feed contract: `timestamp DESC, chainId ASC, blockNumber DESC, logIndex DESC, id ASC`. The contract remains owned by `schema.graphql`; this benchmark only measures it.

## Existing-storage migration

With the Envio writer stopped, apply the stopped-writer SQL to the existing
schema, then synchronize Envio's persisted public-config snapshot. This does
not reset checkpoints or indexed entity rows.

```sh
docker exec -i envio-postgres psql -U postgres -d envio-dev -v ON_ERROR_STOP=1 \
  < apps/indexer/scripts/sql/20260901_hasura_query_latency_indexes.sql

docker exec -i envio-postgres psql -U postgres -d envio-dev -v ON_ERROR_STOP=1 \
  < apps/indexer/scripts/sql/20260901_token_analytics_metric_backfill.sql

cd apps/indexer
node scripts/render-envio-storage-config-sql.mjs --schema etherfi_enriched \
  | docker exec -i envio-postgres psql -U postgres -d envio-dev -v ON_ERROR_STOP=1
```

Reload Hasura metadata after the DDL so `TokenAnalyticsMetric` is exposed
without restarting Envio. Before restarting the writer, compare sampled metric
rows with source-ledger aggregates, especially requested withdrawals and debt
repayments.

The backfill scans approximately 10M spend valuations plus the balance and
event ledgers. It runs in one transaction, so plan a maintenance window and
leave room for WAL and aggregate memory. A pre-commit failure rolls back the
new metric tables atomically. Do not delete source rows, history, or
checkpoints.
