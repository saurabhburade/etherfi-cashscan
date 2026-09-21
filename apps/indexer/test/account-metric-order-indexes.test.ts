import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../scripts/sql/20260920_account_metric_balance_order_indexes_concurrently.sql", import.meta.url),
  "utf8",
);

const defaultIndex = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "AccountMetric_currentBalanceUsd_desc_nulls_last_id_asc"
  ON "etherfi_enriched"."AccountMetric" ("currentBalanceUsd" DESC NULLS LAST, "id" ASC);`;

const chainIndex = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "AccountMetric_chainId_currentBalanceUsd_desc_nulls_last_id_asc"
  ON "etherfi_enriched"."AccountMetric"
    ("chainId" ASC, "currentBalanceUsd" DESC NULLS LAST, "id" ASC);`;

describe("AccountMetric online sort-index migration", () => {
  it("uses exactly the two indexes required by the observed query shapes", () => {
    expect(migration).toContain(defaultIndex);
    expect(migration).toContain(chainIndex);
    expect(migration.match(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/g)).toHaveLength(2);
  });

  it("is safe to run online and includes read-only verification guidance", () => {
    expect(migration).not.toMatch(/\b(?:BEGIN|COMMIT)\s*;/);
    expect(migration).toContain("indisvalid");
    expect(migration).toContain("pg_get_indexdef(i.oid)");
    expect(migration).toContain("EXPLAIN (ANALYZE, BUFFERS)");
  });
});
