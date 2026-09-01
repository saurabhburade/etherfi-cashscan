#!/usr/bin/env node
/** Read-only benchmark for the materialized TokenAnalyticsMetric query. */

const endpoint = process.env.ENVIO_GRAPHQL_URL ?? process.env.HASURA_GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";
const adminSecret = process.env.ENVIO_HASURA_ADMIN_SECRET ?? process.env.HASURA_GRAPHQL_ADMIN_SECRET;
const repeats = Number(process.env.BENCHMARK_REPEATS ?? 5);
const chainId = process.env.BENCHMARK_CHAIN_ID ? Number(process.env.BENCHMARK_CHAIN_ID) : null;

async function graphql(query, variables = {}) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(adminSecret ? { "x-hasura-admin-secret": adminSecret } : {}),
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = await response.text();
  const elapsedMs = performance.now() - started;
  const payload = JSON.parse(body);
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`);
  }
  return { data: payload.data, elapsedMs, bytes: Buffer.byteLength(body) };
}

const metricQuery = `query TokenAnalyticsMetricBenchmark(
  $tokenWhere: Token_bool_exp!
  $metricWhere: TokenAnalyticsMetric_bool_exp!
) {
  Token(limit: 1000, where: $tokenWhere) {
    chainId address name symbol decimals decimalsVerified
    oracleDecimals oracleHeartbeat price priceUpdatedAt
  }
  TokenAnalyticsMetric(limit: 1000, where: $metricWhere, order_by: [{ chainId: asc }, { tokenAddress: asc }]) {
    chainId tokenAddress spendCount spendAmount spendUsd topUpCount topUpAmount withdrawalCount
    safeAccountCount safeBalance safeInflow safeOutflow
    destinationCount destinationBalance destinationInflow destinationOutflow
    suppliedCount suppliedAmount borrowedCount borrowedAmount borrowedUsd
    repaidCount repaidAmount repaidUsd latestSpendPriceUsdE18 latestSpendPriceStatus
  }
}`;
const where = chainId === null ? {} : { chainId: { _eq: chainId } };
const variables = { tokenWhere: where, metricWhere: where };

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

await graphql(metricQuery, variables);
const samples = [];
for (let index = 0; index < repeats; index += 1) samples.push(await graphql(metricQuery, variables));
const rowCount = samples.at(-1)?.data.TokenAnalyticsMetric?.length ?? 0;
const tokenCount = samples.at(-1)?.data.Token?.length ?? 0;

console.log(
  `Token analytics benchmark (tokens=${tokenCount}; metrics=${rowCount}; repeats=${repeats}; chainId=${chainId ?? "all"})`,
);
console.table([
  {
    operation: "TokenAnalyticsMetric",
    metric_rows: rowCount,
    p50_ms: percentile(
      samples.map((sample) => sample.elapsedMs),
      0.5,
    ).toFixed(1),
    p95_ms: percentile(
      samples.map((sample) => sample.elapsedMs),
      0.95,
    ).toFixed(1),
    max_bytes: Math.max(...samples.map((sample) => sample.bytes)),
  },
]);
