#!/usr/bin/env node
/**
 * Read-only latency benchmark for the Hasura operations used by the Cash UI.
 * This intentionally uses fetch only: it never connects to Postgres or Envio.
 */

const DEFAULT_ENDPOINT = "http://localhost:8080/v1/graphql";

function usage() {
  console.log(`Usage: node apps/indexer/scripts/benchmark-hasura-graphql.mjs [options]

Environment:
  ENVIO_GRAPHQL_URL (or HASURA_GRAPHQL_URL)       Hasura GraphQL endpoint
  ENVIO_HASURA_ADMIN_SECRET (or HASURA_GRAPHQL_ADMIN_SECRET)  optional secret

Options:
  --warmup <n>          Unreported warmup requests per operation (default: 1)
  --repeats <n>         Measured requests per operation (default: 5)
  --chain-id <id>       Apply the web UI's chainId filter
  --only <names>        Comma-separated operation names (for a focused run)
  --max-p95-ms <n>      Fail when any operation p95 exceeds n milliseconds
  --max-max-ms <n>      Fail when any operation max exceeds n milliseconds
  --max-bytes <n>       Fail when any response exceeds n bytes
  --report-only         Always exit zero; still prints failures and thresholds
  --help                Print this help
`);
}

function parseArgs(argv) {
  const result = { warmup: 1, repeats: 5, reportOnly: false, only: null };
  const numeric = new Set(["warmup", "repeats", "chain-id", "max-p95-ms", "max-max-ms", "max-bytes"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") return { help: true };
    if (arg === "--report-only") {
      result.reportOnly = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "only") {
      result.only = (argv[++i] ?? "").split(",").filter(Boolean);
      continue;
    }
    if (!numeric.has(key)) throw new Error(`Unknown option: ${arg}`);
    const value = Number(argv[++i]);
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))
      throw new Error(`${arg} must be a non-negative integer`);
    result[key.replaceAll("-", "_")] = value;
  }
  if (result.repeats < 1) throw new Error("--repeats must be at least 1");
  return result;
}

const args = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(2);
  }
})();
if (args.help) {
  usage();
  process.exit(0);
}

const endpoint = process.env.ENVIO_GRAPHQL_URL ?? process.env.HASURA_GRAPHQL_URL ?? DEFAULT_ENDPOINT;
const adminSecret = process.env.ENVIO_HASURA_ADMIN_SECRET ?? process.env.HASURA_GRAPHQL_ADMIN_SECRET;
const chainWhere = args.chain_id ? { chainId: { _eq: args.chain_id } } : {};
const eventWhere = chainWhere;
const spendDetailIds = (process.env.BENCHMARK_SPEND_DETAIL_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// These operation names, variables, limits, and ordering match apps/web/lib/envio.ts.
const operations = [
  ["Health", `query HasuraBenchmarkHealth { __typename }`, {}],
  [
    "EtherFiCashExplorerCore",
    `query EtherFiCashExplorerCore($activeSafeWhere: ActiveSafe_bool_exp!, $dailyWhere: DailyCashMetric_bool_exp!, $balanceWhere: AccountTokenBalance_bool_exp!) { ActiveSafe_aggregate(where: $activeSafeWhere) { aggregate { count } } DailyCashMetric(limit: 6000, where: $dailyWhere, order_by: { day: desc }) { day spendCount spendUsd activeCardCount newCardCount topUpCount } AccountTokenBalance(limit: 40, where: { _and: [{ amount: { _gt: "0" } }, $balanceWhere] }, order_by: { amount: desc }) { chainId accountAddress accountKind tokenAddress amount } }`,
    { activeSafeWhere: chainWhere, dailyWhere: chainWhere, balanceWhere: chainWhere },
  ],
  [
    "EtherFiCashExplorerGlobalActiveSafes",
    `query EtherFiCashExplorerGlobalActiveSafes { GlobalActiveSafe_aggregate { aggregate { count } } }`,
    {},
  ],
  [
    "EtherFiCashExplorerSpendBuckets",
    `query EtherFiCashExplorerSpendBuckets($where: SpendBucketMetric_bool_exp!) { SpendBucketMetric(where: $where, order_by: { sortOrder: asc }) { bucket sortOrder spendCount spendUsd } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerHourly",
    `query EtherFiCashExplorerHourly($where: HourlySpendMetric_bool_exp!) { HourlySpendMetric(where: $where, order_by: { hour: asc }) { hour spendCount spendUsd } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerEvents",
    `query EtherFiCashExplorerEvents($eventWhere: ProtocolEvent_bool_exp!) { ProtocolEvent(limit: 50, where: $eventWhere, order_by: [{ timestamp: desc }, { chainId: asc }, { blockNumber: desc }, { logIndex: desc }, { id: asc }]) { id eventType chainId blockNumber contractAddress actor tokenAddress amount amountUsd timestamp transactionHash logIndex metadata } }`,
    { eventWhere },
  ],
  ...(spendDetailIds.length
    ? [
        [
          "EtherFiCashExplorerSpendDetails",
          `query EtherFiCashExplorerSpendDetails($ids: [String!]!) { Spend(where: { id: { _in: $ids } }) { id tokens amounts } }`,
          { ids: spendDetailIds },
        ],
      ]
    : []),
  [
    "EtherFiCashExplorerTokens",
    `query EtherFiCashExplorerTokens($where: Token_bool_exp!) { Token(limit: 1000, where: $where) { chainId address name symbol decimals decimalsVerified totalSupply metadataStatus oracleAddress oraclePair oracleDecimals oracleHeartbeat oracleDiscovery price priceUpdatedAt hasSpend hasTopUp hasRepayment hasDebt hasBalance latestSpendPriceUsdE18 latestSpendPriceStatus analyticsUpdatedAt } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerSafeAccounts",
    `query EtherFiCashExplorerSafeAccounts($where: SafeTokenBalance_bool_exp!) { SafeTokenBalance_aggregate(where: { _and: [{ amount: { _gt: "0" } }, $where] }) { aggregate { count } } SafeTokenBalance(limit: 5000, where: { _and: [{ amount: { _gt: "0" } }, $where] }, order_by: [{ updatedAt: desc }, { safeAddress: asc }, { tokenAddress: asc }]) { chainId safeAddress tokenAddress amount inflow outflow updatedAt updatedBlock transactionHash } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerExtendedDaily",
    `query EtherFiCashExplorerExtendedDaily($where: DailyCashMetric_bool_exp!) { DailyCashMetric(limit: 6000, where: $where, order_by: { day: desc }) { day spendCount spendUsd activeCardCount newCardCount topUpCount cashbackUsd onrampUsd offrampUsd borrowedUsd repaidUsd creditSpendUsd debitSpendUsd } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerCashbackTotal",
    `query EtherFiCashExplorerCashbackTotal($where: CashbackReceiverMetric_bool_exp!) { CashbackReceiverMetric_aggregate(where: $where) { aggregate { sum { rewardCount amountUsd } } } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerTopUpRecipients",
    `query EtherFiCashExplorerTopUpRecipients($where: TopUpRecipientMetric_bool_exp!) { TopUpRecipientMetric(limit: 10, where: $where, order_by: [{ topUpCount: desc }, { recipient: asc }]) { chainId recipient topUpCount } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerCashbackReceivers",
    `query EtherFiCashExplorerCashbackReceivers($where: CashbackReceiverMetric_bool_exp!) { CashbackReceiverMetric(limit: 10, where: $where, order_by: [{ amountUsd: desc }, { recipient: asc }]) { chainId recipient rewardCount amountUsd } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerRepaymentTotal",
    `query EtherFiCashExplorerRepaymentTotal($where: Repayment_bool_exp!) { Repayment_aggregate(where: $where) { aggregate { sum { amountUsd } } } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerRampTokenMetrics",
    `query EtherFiCashExplorerRampTokenMetrics($where: RampVolumeSnapshot_bool_exp!) { RampVolumeSnapshot_aggregate(where: $where) { aggregate { count } } RampVolumeSnapshot(limit: 6000, where: $where, order_by: { dayTimestamp: desc }) { chainId label token rampKind dayTimestamp amountRaw rawDecimals amountUsd usdDecimals fxStatus } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerFxRates",
    `query EtherFiCashExplorerFxRates($where: DailyFxRate_bool_exp!, $stateWhere: PriceFeedState_bool_exp!) { DailyFxRate(limit: 5000, where: $where, order_by: { day: asc }) { chainId day answer decimals updatedAt } PriceFeedState(where: $stateWhere) { chainId pair answer decimals updatedAt } }`,
    { where: chainWhere, stateWhere: chainWhere },
  ],
  [
    "EtherFiCashExplorerDebtMetrics",
    `query EtherFiCashExplorerDebtMetrics($where: DebtPosition_bool_exp!) { DebtPosition_aggregate(where: $where) { aggregate { count sum { borrowedUsd repaidUsd outstandingUsd } } } DebtPosition(limit: 5000, where: $where, order_by: { outstandingUsd: desc }) { chainId user tokenAddress borrowedUsd repaidUsd outstandingUsd usdStatus } }`,
    { where: chainWhere },
  ],
  [
    "EtherFiCashExplorerSafeState",
    `query EtherFiCashExplorerSafeState($tierWhere: SafeTierState_bool_exp!, $lendWhere: SafeLendState_bool_exp!, $modeWhere: SafeModeState_bool_exp!, $limitWhere: SafeSpendingLimitState_bool_exp!, $withdrawalWhere: PendingWithdrawalState_bool_exp!, $cashbackWhere: PendingCashbackBalance_bool_exp!) { SafeTierState(limit: 5000, where: $tierWhere) { chainId safe tierId updatedAt } tier0: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 0 } }] }) { aggregate { count } } tier1: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 1 } }] }) { aggregate { count } } tier2: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 2 } }] }) { aggregate { count } } tier3: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 3 } }] }) { aggregate { count } } tier4: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 4 } }] }) { aggregate { count } } SafeLendState(limit: 5000, where: $lendWhere) { chainId safe status finalizeTime updatedAt } SafeModeState(limit: 5000, where: $modeWhere) { chainId safe currentModeId pendingModeId activationTime updatedAt } SafeSpendingLimitState(limit: 5000, where: $limitWhere) { chainId safe dailyLimit monthlyLimit spentToday spentThisMonth newDailyLimit newMonthlyLimit dailyLimitChangeActivationTime monthlyLimitChangeActivationTime updatedAt } PendingWithdrawalState(limit: 5000, where: $withdrawalWhere) { chainId safe status } PendingCashbackBalance(limit: 5000, where: $cashbackWhere) { chainId recipient tokenAddress amountUsd } }`,
    {
      tierWhere: chainWhere,
      lendWhere: chainWhere,
      modeWhere: chainWhere,
      limitWhere: chainWhere,
      withdrawalWhere: chainWhere,
      cashbackWhere: chainWhere,
    },
  ],
  [
    "EtherFiCashExplorerCashHistory",
    `query EtherFiCashExplorerCashHistory($tierWhere: SafeTierChange_bool_exp!, $modeWhere: SafeModeChange_bool_exp!) { SafeTierChange_aggregate(where: $tierWhere) { aggregate { count } } SafeTierChange(limit: 5000, where: $tierWhere, order_by: { timestamp: desc }) { previousTierId tierId timestamp } SafeModeChange_aggregate(where: $modeWhere) { aggregate { count } } SafeModeChange(limit: 5000, where: $modeWhere, order_by: { timestamp: desc }) { previousModeId modeId timestamp } }`,
    { tierWhere: chainWhere, modeWhere: chainWhere },
  ],
  [
    "EtherFiCashExplorerCashOperations",
    `query EtherFiCashExplorerCashOperations($resupplyWhere: CollateralResupply_bool_exp!, $failureWhere: LendSupplyFailure_bool_exp!) { CollateralResupply_aggregate(where: $resupplyWhere) { aggregate { count } } LendSupplyFailure_aggregate(where: $failureWhere) { aggregate { count } } }`,
    { resupplyWhere: chainWhere, failureWhere: chainWhere },
  ],
  [
    "EtherFiCashExplorerConfiguration",
    `query EtherFiCashExplorerConfiguration($tierWhere: TierCashbackPercentage_bool_exp!, $splitWhere: SafeCashbackSplit_bool_exp!, $delaysWhere: CashDelaysState_bool_exp!, $dispatcherWhere: SettlementDispatcherState_bool_exp!, $gatewayWhere: LendGatewayState_bool_exp!, $tokenWhere: WithdrawalTokenWhitelist_bool_exp!, $moduleWhere: WithdrawalModuleWhitelist_bool_exp!) { TierCashbackPercentage(limit: 100, where: $tierWhere) { chainId tierId percentage updatedAt } SafeCashbackSplit(limit: 5000, where: $splitWhere) { chainId safe splitInBps updatedAt } CashDelaysState(limit: 100, where: $delaysWhere) { chainId withdrawalDelay spendingLimitDelay modeDelay updatedAt } SettlementDispatcherState(limit: 100, where: $dispatcherWhere) { chainId binSponsorId dispatcher updatedAt } LendGatewayState(limit: 100, where: $gatewayWhere) { chainId gateway updatedAt } WithdrawalTokenWhitelist(limit: 5000, where: $tokenWhere) { chainId tokenAddress whitelisted updatedAt } WithdrawalModuleWhitelist(limit: 5000, where: $moduleWhere) { chainId moduleAddress whitelisted updatedAt } }`,
    {
      tierWhere: chainWhere,
      splitWhere: chainWhere,
      delaysWhere: chainWhere,
      dispatcherWhere: chainWhere,
      gatewayWhere: chainWhere,
      tokenWhere: chainWhere,
      moduleWhere: chainWhere,
    },
  ],
];

const selected = args.only ? operations.filter(([name]) => args.only.includes(name)) : operations;
if (!selected.length) {
  console.error("No operations selected. Check --only names.");
  process.exit(2);
}
if (args.only) {
  const found = new Set(selected.map(([name]) => name));
  const unknown = args.only.filter((name) => !found.has(name));
  if (unknown.length) {
    console.error(`Unknown operation(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function summarize(data) {
  if (!data || typeof data !== "object") return "no data";
  return Object.entries(data)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}:${value.length} rows`;
      if (value && typeof value === "object" && "aggregate" in value) return `${key}:aggregate`;
      return `${key}:value`;
    })
    .join(", ");
}

async function request([name, query, variables]) {
  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(adminSecret ? { "x-hasura-admin-secret": adminSecret } : {}) },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    const body = await response.text();
    const elapsedMs = performance.now() - started;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }
    const errors = payload?.errors?.map((error) => error.message).filter(Boolean) ?? [];
    return {
      name,
      elapsedMs,
      bytes: Buffer.byteLength(body),
      ok: response.ok && errors.length === 0,
      status: response.status,
      errors,
      summary: summarize(payload?.data),
    };
  } catch (error) {
    return {
      name,
      elapsedMs: performance.now() - started,
      bytes: 0,
      ok: false,
      status: "network",
      errors: [error instanceof Error ? error.message : String(error)],
      summary: "no data",
    };
  }
}

for (const operation of selected) for (let i = 0; i < args.warmup; i += 1) await request(operation);
const rows = [];
for (const operation of selected) {
  const samples = [];
  for (let i = 0; i < args.repeats; i += 1) samples.push(await request(operation));
  const successful = samples.filter((sample) => sample.ok);
  const latencies = successful.map((sample) => sample.elapsedMs);
  rows.push({
    operation: operation[0],
    requests: samples.length,
    failures: samples.filter((sample) => !sample.ok).length,
    p50: latencies.length ? percentile(latencies, 0.5) : null,
    p95: latencies.length ? percentile(latencies, 0.95) : null,
    max: latencies.length ? Math.max(...latencies) : null,
    maxBytes: Math.max(...samples.map((sample) => sample.bytes)),
    summary: samples.at(-1).summary,
    errors: [...new Set(samples.flatMap((sample) => sample.errors))],
  });
}

const thresholds = { p95: args.max_p95_ms, max: args.max_max_ms, bytes: args.max_bytes };
const failures = rows.flatMap((row) => {
  const problems = [];
  if (row.failures) problems.push(`${row.failures} query failure(s): ${row.errors.join("; ")}`);
  if (thresholds.p95 !== undefined && (row.p95 === null || row.p95 > thresholds.p95))
    problems.push(`p95 ${row.p95?.toFixed(1) ?? "n/a"}ms > ${thresholds.p95}ms`);
  if (thresholds.max !== undefined && (row.max === null || row.max > thresholds.max))
    problems.push(`max ${row.max?.toFixed(1) ?? "n/a"}ms > ${thresholds.max}ms`);
  if (thresholds.bytes !== undefined && row.maxBytes > thresholds.bytes)
    problems.push(`response ${row.maxBytes}B > ${thresholds.bytes}B`);
  return problems.map((problem) => `${row.operation}: ${problem}`);
});

console.log(
  `Hasura read-only benchmark (${selected.length} operations; warmup=${args.warmup}; repeats=${args.repeats}; chainId=${args.chain_id ?? "all"})`,
);
console.table(
  rows.map((row) => ({
    operation: row.operation,
    requests: row.requests,
    failures: row.failures,
    p50_ms: row.p50?.toFixed(1) ?? "n/a",
    p95_ms: row.p95?.toFixed(1) ?? "n/a",
    max_ms: row.max?.toFixed(1) ?? "n/a",
    max_bytes: row.maxBytes,
    rows_or_counts: row.summary,
  })),
);
if (failures.length) console.error(`FAIL\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
else console.log("PASS");
process.exit(args.reportOnly ? 0 : failures.length ? 1 : 0);
