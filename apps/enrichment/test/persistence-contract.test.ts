import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { accountUpsertPlan, eventUpsertPlan, legUpsertPlan, tokenMetadataUpsertPlan } from "../src/repository.js";

const migrationPath = fileURLToPath(new URL("../migrations/20260901_cash_explorer_additive.sql", import.meta.url));
const lendingMigrationPath = fileURLToPath(new URL("../migrations/20260902_lending_accounting.sql", import.meta.url));
const migrationRunnerPath = fileURLToPath(new URL("../scripts/apply-migration.mjs", import.meta.url));
const insert = (plan: { text: string }) => {
  const match = plan.text.match(/INSERT INTO cash_explorer\.(\w+)\s*\(([^)]+)\)/);
  if (!match) throw new Error("not an insert");
  return { table: match[1], columns: match[2].split(",").map((value) => value.trim()) };
};
const tableColumns = (migration: string, table: string) => {
  const match = migration.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS cash_explorer\\.${table} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!match) throw new Error(`missing table ${table}`);
  return new Set(
    match[1]
      .split("\n")
      .map((line) => line.trim().match(/^(\w+)\s/)?.[1])
      .filter((column): column is string => Boolean(column) && column !== "CONSTRAINT"),
  );
};
describe("persistence contract", () =>
  it("uses only columns from each finalized table", () => {
    // The migration is supplied by the integration worktree; isolated unit runs
    // intentionally do not manufacture it.
    if (!existsSync(migrationPath)) return;
    const migration = readFileSync(migrationPath, "utf8");
    const plans = [
      accountUpsertPlan(1, "0xa"),
      tokenMetadataUpsertPlan({
        chainId: 1,
        address: "0xt",
        name: "t",
        symbol: "t",
        decimals: 6,
        decimalsVerified: true,
        metadataStatus: "ok",
      }),
      eventUpsertPlan({
        id: "1:0x:0",
        chainId: 1,
        transactionHash: "0x",
        blockHash: "h",
        sourceProvenance: "test",
        eventType: "x",
        accountAddress: null,
        tokenAddress: null,
        amount: null,
        amountUsd: null,
        usdDecimals: 6,
        usdStatus: "unpriced",
        accountingRole: "canonical",
        accountingDirection: "neutral",
        accountingKind: "x",
        metadata: {},
        timestamp: "2026-01-01T00:00:00Z",
        blockNumber: "1",
        logIndex: 0,
      }),
      legUpsertPlan(1, {
        id: "x",
        scannerEventId: "1:0x:0",
        tokenAddress: "0xt",
        tokenIndex: 0,
        direction: "neutral",
        amount: 1n,
        amountUsd: null,
        usdDecimals: 6,
        usdStatus: "unpriced",
        priceUsdE18: null,
      }),
    ];
    for (const plan of plans) {
      const statement = insert(plan);
      const allowed = tableColumns(migration, statement.table);
      for (const column of statement.columns)
        assert.ok(allowed.has(column), `${statement.table}.${column} is not a migration column`);
    }
  }));

describe("lending persistence contract", () =>
  it("keeps cross-source accounting and block-exact snapshots explicit", () => {
    assert.ok(existsSync(lendingMigrationPath));
    const migration = readFileSync(lendingMigrationPath, "utf8");
    for (const fragment of [
      "account_identity_address_key UNIQUE (address)",
      "ADD COLUMN IF NOT EXISTS identity_id",
      "action_type IN ('deposit', 'spend', 'withdrawal', 'cashback', 'fee', 'other'",
      "economic_action_source_exactly_one",
      "scanner_event_id text UNIQUE",
      "lending_event_source_kind CHECK (source_kind IN ('cash', 'gateway', 'spoke'))",
      "reserve_number numeric(78,0) NOT NULL",
      "leg_type IN ('supply', 'withdraw', 'borrow', 'repay', 'debt_restored'",
      "supplied_shares >= 0 AND drawn_shares >= 0 AND premium_shares >= 0",
      "economic_action_account_chain_fkey",
      "risk_premium_ray numeric",
      "total_collateral_value_raw numeric",
      "total_debt_value_ray_raw numeric",
      "supplied_shares numeric NOT NULL DEFAULT 0",
      "premium_offset_ray numeric NOT NULL DEFAULT 0",
      "health_factor_e18 numeric",
      "price_provider_current",
      "account_daily_metric_legacy_token_rows",
    ])
      assert.ok(migration.includes(fragment), `missing ${fragment}`);
    assert.ok(!migration.includes("aave_price_provider_current"));
    assert.ok(!migration.includes("TRUNCATE "));
    assert.ok(
      readFileSync(migrationRunnerPath, "utf8").includes("20260902_lending_accounting.sql"),
      "the one-shot migration runner must include lending accounting",
    );
  }));
