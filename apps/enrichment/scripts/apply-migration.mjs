import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrations = [
  fileURLToPath(new URL("../migrations/20260901_cash_explorer_additive.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/20260901_cash_explorer_account_analytics.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/20260901_cashback_attribution.sql", import.meta.url)),
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Refusing to guess a database target.");
  process.exit(1);
}
for (const migration of migrations) if (!existsSync(migration)) throw new Error(`Missing migration: ${migration}`);

// psql runs a single transactional, idempotent DDL file. There is no reset,
// truncation, drop, Envio command, or schema search-path mutation in this script.
for (const migration of migrations) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", process.env.DATABASE_URL, "-f", migration], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
