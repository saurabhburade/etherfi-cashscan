import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. This read-only benchmark does not infer a target.");
  process.exit(1);
}
const sql = fileURLToPath(new URL("../migrations/20260901_cash_explorer_validation.sql", import.meta.url));
const result = spawnSync(
  "psql",
  [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    "ts='1970-01-01T00:00:00Z'",
    "-v",
    "chain=0",
    "-v",
    "block=0",
    "-v",
    "log=0",
    "-v",
    "id=''",
    process.env.DATABASE_URL,
    "-f",
    sql,
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
