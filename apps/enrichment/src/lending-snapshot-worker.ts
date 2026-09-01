import { fetchLendingStateSnapshots, type LendingSnapshotRequest } from "./lending-snapshots.js";
import { rpcBlockNumber } from "./price-provider-rpc.js";
import type { SqlExecutor } from "./worker.js";

/** Bounded worker-only state enrichment. Projection never calls RPC. */
export async function runLendingSnapshotBatch(
  sql: SqlExecutor,
  options: { chainId: number; rpcUrl: string; confirmations: bigint; limit?: number; fetcher?: typeof fetch },
) {
  const limit = options.limit ?? 100;
  const preflight = await sql.query(CANDIDATE_SQL, [options.chainId, "9223372036854775807", 1]);
  if (preflight.rows.length === 0) return { head: null, finalized: null, selected: 0, snapshots: [] };
  const head = await rpcBlockNumber(options.rpcUrl, options.fetcher);
  const finalized = head > options.confirmations ? head - options.confirmations : 0n;
  const rows = (await sql.query(CANDIDATE_SQL, [options.chainId, finalized.toString(), limit])).rows;
  const requests: LendingSnapshotRequest[] = rows.map((row) => ({
    chainId: Number(row.chain_id),
    safeAddress: String(row.safe_address) as `0x${string}`,
    spokeAddress: String(row.spoke_address) as `0x${string}`,
    blockNumber: BigInt(String(row.block_number)),
    trigger: String(row.trigger) === "risk" ? "risk" : "normal",
    reserves: (Array.isArray(row.reserves) ? row.reserves : JSON.parse(String(row.reserves ?? "[]"))).map(
      (r: { reserveId: string; tokenAddress: string | null }) => ({
        reserveId: BigInt(r.reserveId),
        tokenAddress: r.tokenAddress as `0x${string}` | null,
      }),
    ),
  }));
  const snapshots = await fetchLendingStateSnapshots({ rpcUrl: options.rpcUrl, requests, fetcher: options.fetcher });
  return { head, finalized, selected: requests.length, snapshots };
}

export async function markLendingFinalized(sql: SqlExecutor, chainId: number, blockNumber: bigint) {
  await sql.begin();
  try {
    await sql.query(
      `UPDATE cash_explorer.lending_event
       SET finality_status='finalized',updated_at=now()
       WHERE chain_id=$1 AND block_number<=$2 AND finality_status='observed'`,
      [chainId, blockNumber.toString()],
    );
    await sql.query(
      `UPDATE cash_explorer.economic_action action
       SET finality_status='finalized',updated_at=now()
       WHERE action.chain_id=$1 AND action.finality_status='observed'
        AND EXISTS (
          SELECT 1 FROM cash_explorer.lending_event event
          WHERE event.economic_action_id=action.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM cash_explorer.lending_event event
          WHERE event.economic_action_id=action.id AND event.finality_status<>'finalized'
        )`,
      [chainId],
    );
    await sql.commit();
  } catch (error) {
    await sql.rollback();
    throw error;
  }
}

/** One candidate per Safe/market/activity bucket; risk changes retain block
 * precision. Existing snapshots suppress repeat calls, and all active reserves
 * are attached before the RPC batch is built. */
export const CANDIDATE_SQL = `
WITH changed AS (
 SELECT e.chain_id,e.account_identity_id,i.address AS safe_address,m.spoke_address,e.market_id,e.block_number,
  CASE WHEN e.event_type IN ('borrow','repay','withdraw','liquidation') THEN 'risk' ELSE 'normal' END AS trigger,
  date_trunc('hour',e.occurred_at)+floor(date_part('minute',e.occurred_at)/15)*interval '15 minutes' AS bucket
 FROM cash_explorer.lending_event e JOIN cash_explorer.account_identity i ON i.id=e.account_identity_id
 JOIN cash_explorer.lending_market m ON m.id=e.market_id
 WHERE e.chain_id=$1 AND e.block_number<=$2
  AND e.event_type IN ('supply','withdraw','borrow','repay','liquidation','collateral_enable','collateral_disable','deficit')
), coalesced AS (
 SELECT DISTINCT ON (safe_address,market_id,CASE WHEN trigger='risk' THEN block_number::text ELSE bucket::text END)
  * FROM changed ORDER BY safe_address,market_id,CASE WHEN trigger='risk' THEN block_number::text ELSE bucket::text END,block_number DESC
), pending AS (
 SELECT c.* FROM coalesced c WHERE NOT EXISTS (
  SELECT 1 FROM cash_explorer.lending_account_snapshot s WHERE s.account_identity_id=c.account_identity_id
   AND s.market_id=c.market_id AND s.block_number=c.block_number
   AND s.snapshot_kind IN ('event','checkpoint','refresh')
   AND (s.state_status<>'unavailable' OR s.observed_at>now()-interval '15 minutes'))
)
SELECT p.chain_id,p.safe_address,p.spoke_address,p.block_number,p.trigger,
 COALESCE((
  SELECT json_agg(json_build_object('reserveId',r.reserve_number::text,'tokenAddress',t.address)
    ORDER BY r.reserve_number)
  FROM cash_explorer.lending_reserve r
  JOIN cash_explorer.token t ON t.id=r.asset_token_id
  WHERE r.market_id=p.market_id AND r.is_active
 ),'[]'::json) AS reserves
FROM pending p
ORDER BY p.block_number LIMIT $3`;
