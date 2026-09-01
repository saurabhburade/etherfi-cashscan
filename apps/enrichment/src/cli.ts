import postgres from "postgres";
import { runBackfill } from "./backfill.js";
import { createGraphqlSourceAdapter } from "./graphql-adapter.js";
import { markLendingFinalized, runLendingSnapshotBatch } from "./lending-snapshot-worker.js";
import { refreshCurrentPrices, runHistoricalPriceBackfill } from "./price-enrichment.js";
import { graphqlHttpTransport, PostgresEnrichmentStore, requiredWorkerEnv, type SqlExecutor } from "./worker.js";

export function postgresExecutor(databaseUrl: string): SqlExecutor & { close(): Promise<void> } {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  return {
    begin: async () => {
      await client.unsafe("BEGIN");
    },
    commit: async () => {
      await client.unsafe("COMMIT");
    },
    rollback: async () => {
      await client.unsafe("ROLLBACK");
    },
    query: async (text, values = []) => ({
      rows: [...(await client.unsafe(text, values as never[]))] as Array<Record<string, unknown>>,
    }),
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

export async function runBatches(
  sql: SqlExecutor,
  env: Record<string, string | undefined> = process.env,
  options: {
    maxBatches?: number;
    dryRun?: boolean;
    onBatch?: (result: Awaited<ReturnType<typeof runBackfill>>, batch: number) => void;
  } = {},
) {
  const config = requiredWorkerEnv(env);
  const adapter = createGraphqlSourceAdapter(
    graphqlHttpTransport(config.graphqlUrl, fetch, env.ENVIO_HASURA_ADMIN_SECRET),
  );
  const store = new PostgresEnrichmentStore(sql, options.dryRun ?? false);
  const results = [];
  const maxBatches = options.maxBatches ?? 1;
  for (let index = 0; index < maxBatches; index += 1) {
    const result = await runBackfill(adapter, store);
    results.push(result);
    options.onBatch?.(result, index + 1);
    if (!result.locked || result.processed === 0 || options.dryRun) break;
  }
  return results;
}

function integerFlag(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  const parsed = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function bigintFlag(name: string): bigint {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!raw || !/^\d+$/.test(raw)) throw new Error(`--${name} is required and must be a non-negative integer`);
  return BigInt(raw);
}

function chainFlag() {
  return integerFlag("chain-id", 0);
}

function rpcEnv(chainId: number, historical: boolean, env: Record<string, string | undefined> = process.env) {
  const prefix = chainId === 10 ? "OPTIMISM" : chainId === 534352 ? "SCROLL" : `CHAIN_${chainId}`;
  const key = historical ? `${prefix}_ARCHIVE_RPC_URL` : `${prefix}_RPC_URL`;
  const rpcUrl = env[key] ?? (!historical ? env[`${prefix}_ARCHIVE_RPC_URL`] : undefined);
  if (!rpcUrl)
    throw new Error(
      `${key} is required${historical ? "; historical eth_call never falls back to a latest-only RPC" : ""}`,
    );
  return { rpcUrl, fallbackRpcUrl: env[`${prefix}_ARCHIVE_RPC_FALLBACK_URL`] };
}

function optionalCurrentRpc(chainId: number, env: Record<string, string | undefined> = process.env) {
  const prefix = chainId === 10 ? "OPTIMISM" : chainId === 534352 ? "SCROLL" : `CHAIN_${chainId}`;
  return env[`${prefix}_RPC_URL`] ?? env[`${prefix}_ARCHIVE_RPC_URL`] ?? null;
}

async function refreshConfiguredCurrentPrices(sql: SqlExecutor) {
  for (const chainId of [10, 534352]) {
    const rpcUrl = optionalCurrentRpc(chainId);
    if (!rpcUrl) continue;
    try {
      const result = await refreshCurrentPrices(sql, { chainId, rpcUrl });
      console.log(JSON.stringify({ type: "current_price_refresh", chainId, ...result }));
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "current_price_refresh_error",
          chainId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

async function refreshConfiguredLendingSnapshots(sql: SqlExecutor) {
  const rpcUrl = process.env.OPTIMISM_ARCHIVE_RPC_URL;
  if (!rpcUrl) return;
  try {
    const result = await runLendingSnapshotBatch(sql, {
      chainId: 10,
      rpcUrl,
      confirmations: 20n,
      limit: 100,
    });
    if (result.finalized != null) await markLendingFinalized(sql, 10, result.finalized);
    await new PostgresEnrichmentStore(sql, false).writeLendingSnapshots(result.snapshots);
    console.log(
      JSON.stringify({
        type: "lending_snapshots",
        chainId: 10,
        selected: result.selected,
        finalized: result.finalized?.toString() ?? null,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "lending_snapshots_error",
        chainId: 10,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function main() {
  const command = process.argv[2] ?? "backfill";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const sql = postgresExecutor(databaseUrl);
  try {
    if (command === "backfill") {
      requiredWorkerEnv();
      const results = await runBatches(sql, process.env, {
        maxBatches: integerFlag("max-batches", 1),
        dryRun: process.argv.includes("--dry-run"),
        onBatch: (result, batch) => console.log(JSON.stringify({ type: "backfill_progress", batch, ...result })),
      });
      console.log(JSON.stringify(results.at(-1) ?? null));
      return;
    }
    if (command === "worker") {
      requiredWorkerEnv();
      const pollMs = integerFlag("poll-ms", 300_000);
      for (;;) {
        const results = await runBatches(sql, process.env, {
          maxBatches: integerFlag("max-batches", 20),
          onBatch: (result, batch) => console.log(JSON.stringify({ type: "worker_progress", batch, ...result })),
        });
        console.log(JSON.stringify(results.at(-1) ?? null));
        await refreshConfiguredLendingSnapshots(sql);
        await refreshConfiguredCurrentPrices(sql);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
    if (command === "price-backfill") {
      const chainId = chainFlag();
      const rpc = rpcEnv(chainId, true);
      const results = await runHistoricalPriceBackfill(sql, {
        chainId,
        fromBlock: bigintFlag("from-block"),
        toBlock: bigintFlag("to-block"),
        rpcUrl: rpc.rpcUrl,
        fallbackRpcUrl: rpc.fallbackRpcUrl,
        batchSize: integerFlag("batch-size", 500),
        maxBatches: integerFlag("max-batches", 1),
        dryRun: process.argv.includes("--dry-run"),
        onBatch: (item) => console.log(JSON.stringify({ type: "historical_price_progress", ...item })),
      });
      console.log(JSON.stringify(results.at(-1) ?? null));
      return;
    }
    if (command === "price-refresh") {
      const chainId = chainFlag();
      const rpc = rpcEnv(chainId, false);
      const result = await refreshCurrentPrices(sql, {
        chainId,
        rpcUrl: rpc.rpcUrl,
        confirmations: BigInt(integerFlag("confirmations", 20)),
        limit: integerFlag("limit", 1_000),
        dryRun: process.argv.includes("--dry-run"),
      });
      console.log(JSON.stringify({ type: "current_price_refresh", ...result }));
      return;
    }
    if (command === "lending-snapshots") {
      const chainId = chainFlag();
      const rpc = rpcEnv(chainId, true);
      const result = await runLendingSnapshotBatch(sql, {
        chainId,
        rpcUrl: rpc.rpcUrl,
        confirmations: BigInt(integerFlag("confirmations", 20)),
        limit: integerFlag("limit", 100),
      });
      if (!process.argv.includes("--dry-run")) {
        if (result.finalized != null) await markLendingFinalized(sql, chainId, result.finalized);
        await new PostgresEnrichmentStore(sql, false).writeLendingSnapshots(result.snapshots);
      }
      console.log(
        JSON.stringify({
          type: "lending_snapshots",
          selected: result.selected,
          finalized: result.finalized?.toString() ?? null,
        }),
      );
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } finally {
    await sql.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
