import { readFile } from "node:fs/promises";

const base = new URL("../migrations/", import.meta.url);
const migration = await readFile(new URL("20260901_cash_explorer_additive.sql", base), "utf8");
const accountMigration = await readFile(new URL("20260901_cash_explorer_account_analytics.sql", base), "utf8");
const cashbackMigration = await readFile(new URL("20260901_cashback_attribution.sql", base), "utf8");
const validation = await readFile(new URL("20260901_cash_explorer_validation.sql", base), "utf8");
const metadata = JSON.parse(await readFile(new URL("hasura-cash-explorer-metadata.json", base), "utf8"));
const tables = [
  "account",
  "token",
  "scanner_event",
  "scanner_event_token_leg",
  "account_token_metric",
  "account_token_event",
  "account_metric",
  "account_daily_metric",
  "account_token_daily_metric",
  "token_daily_metric",
  "token_price_source",
  "token_price_observation",
  "token_price_current",
  "price_anomaly",
  "explorer_checkpoint",
];
for (const table of tables) {
  if (!migration.includes(`cash_explorer.${table}`) && !accountMigration.includes(`cash_explorer.${table}`))
    throw new Error(`Missing canonical table: ${table}`);
}
for (const fragment of [
  "CREATE SCHEMA IF NOT EXISTS cash_explorer",
  "scanner_event_global_keyset_idx",
  "decimals_verified boolean NOT NULL DEFAULT false",
  "raw_amount numeric NOT NULL",
  "amount_usd_raw numeric",
  "usd_decimals integer NOT NULL DEFAULT 6",
  "price_usd_e18 numeric",
  "source_provenance jsonb",
  "accounting_role text NOT NULL",
  "canonical_group_id text",
  "accounting_role = 'duplicate' AND is_audit_duplicate",
  "usd_status = 'priced' OR (amount_usd IS NULL AND amount_usd_raw IS NULL)",
  "block_hash text,",
  "safe_balance_amount numeric",
  "withdrawal_finalized_amount numeric",
  "credit_usd numeric",
  "debit_usd numeric",
  "event_count bigint",
  "volume_usd numeric",
  "explorer_checkpoint",
]) {
  if (!migration.includes(fragment)) throw new Error(`Missing contract fragment: ${fragment}`);
}
for (const forbidden of ["etherfi_enriched", "envio_history_", "TRUNCATE ", "DROP TABLE", "ALTER TABLE public."]) {
  if (migration.includes(forbidden)) throw new Error(`Forbidden migration reference: ${forbidden}`);
}
if (metadata.type !== "bulk" || !Array.isArray(metadata.args)) throw new Error("Invalid Hasura bulk metadata payload");
const tracked = new Map(
  metadata.args
    .filter((operation) => operation.type === "pg_track_table")
    .map((operation) => [operation.args.table.name, operation.args.configuration]),
);
for (const [table, typeName] of Object.entries({
  scanner_event: "ScannerEvent",
  scanner_event_token_leg: "ScannerEventTokenLeg",
  account_token_metric: "AccountTokenMetric",
  token_daily_metric: "TokenDailyMetric",
  token_price_current: "TokenPriceCurrent",
  account_token_event: "AccountTokenEvent",
  account_metric: "AccountMetric",
  account_daily_metric: "AccountDailyMetric",
})) {
  const configuration = tracked.get(table);
  const roots = configuration?.custom_root_fields;
  if (
    (!configuration?.column_config && !configuration?.custom_column_names) ||
    configuration.custom_name !== typeName ||
    roots?.select !== typeName ||
    roots.select_by_pk !== `${typeName}_by_pk` ||
    roots.select_aggregate !== `${typeName}_aggregate`
  )
    throw new Error(`Invalid web configuration for ${typeName}`);
}
for (const [table, column, name] of [
  ["scanner_event", "amount_usd_raw", "amountUsdRaw"],
  ["scanner_event", "usd_decimals", "usdDecimals"],
  ["scanner_event", "price_usd_e18", "priceUsdE18"],
  ["scanner_event_token_leg", "raw_amount", "amount"],
  ["scanner_event_token_leg", "usd_status", "priceStatus"],
  ["scanner_event_token_leg", "amount_usd_raw", "amountUsdRaw"],
  ["scanner_event_token_leg", "price_usd_e18", "priceUsdE18"],
  ["token_price_current", "price_usd_e18", "priceUsdE18"],
  ["token_price_current", "price_status", "priceStatus"],
  ["token_price_current", "source_type", "sourceType"],
  ["account_token_metric", "safe_inflow_amount", "safeInflowAmount"],
  ["account_token_metric", "safe_outflow_amount", "safeOutflowAmount"],
  ["account_token_metric", "current_balance_usd", "currentBalanceUsd"],
  ["account_token_event", "canonical_movement_key", "canonicalMovementKey"],
  ["account_metric", "net_worth_usd", "netWorthUsd"],
  ["account_daily_metric", "closing_balance_status", "closingBalanceStatus"],
  ["account_token_event", "cashback_type", "cashbackType"],
  ["account_metric", "lifetime_cashback_generated_usd", "lifetimeCashbackGeneratedUsd"],
  ["account_metric", "lifetime_cashback_received_usd", "lifetimeCashbackReceivedUsd"],
  ["account_metric", "lifetime_cashback_generated_for_others_usd", "lifetimeCashbackGeneratedForOthersUsd"],
  ["account_metric", "lifetime_cashback_regular_usd", "lifetimeCashbackRegularUsd"],
  ["account_metric", "lifetime_cashback_spender_usd", "lifetimeCashbackSpenderUsd"],
  ["account_metric", "lifetime_cashback_promotion_usd", "lifetimeCashbackPromotionUsd"],
  ["account_metric", "lifetime_cashback_referral_usd", "lifetimeCashbackReferralUsd"],
  ["account_metric", "lifetime_cashback_other_usd", "lifetimeCashbackOtherUsd"],
]) {
  const configuration = tracked.get(table);
  if (
    configuration?.column_config?.[column]?.custom_name !== name &&
    configuration?.custom_column_names?.[column] !== name
  )
    throw new Error(`Missing web field ${name}`);
}
const relationshipNames = new Set(
  metadata.args
    .filter(
      (operation) =>
        operation.type === "pg_create_object_relationship" || operation.type === "pg_create_array_relationship",
    )
    .map((operation) => operation.args.name),
);
for (const name of ["tokenLegs", "scannerEvent", "token", "account", "dailyMetrics"])
  if (!relationshipNames.has(name)) throw new Error(`Missing web relationship ${name}`);
if (!validation.includes("EXPLAIN (COSTS false)")) throw new Error("Missing keyset EXPLAIN validation");
for (const fragment of ["cashback_type numeric", "cashback_other_amount", "cashback_attribution"])
  if (!cashbackMigration.includes(fragment)) throw new Error(`Missing cashback attribution fragment: ${fragment}`);
if (cashbackMigration.includes("cashback_type BETWEEN 0 AND 3"))
  throw new Error("cashbackType must retain valid uint256 values outside the named enum buckets");
console.log(
  `Validated ${tables.length} canonical tables, ${metadata.args.length} Hasura operations, web-query roots/fields/relationships, and read-only validation SQL.`,
);
