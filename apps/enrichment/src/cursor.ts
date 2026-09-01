import type { EventCursor } from "./types.js";

export type Checkpoint = { name: string; cursor: EventCursor | null; updatedAt: string };
export type BackfillRange = { after: EventCursor | null; limit: number };
export function nextRange(checkpoint: Checkpoint | null, limit = 500): BackfillRange {
  return { after: checkpoint?.cursor ?? null, limit };
}
export function checkpointAfter(
  cursor: EventCursor,
  name = "cash-explorer-enrichment",
  now = new Date().toISOString(),
): Checkpoint {
  return {
    name,
    cursor: {
      timestamp: cursor.timestamp,
      chainId: cursor.chainId,
      blockNumber: String(cursor.blockNumber),
      logIndex: cursor.logIndex,
      id: cursor.id,
    },
    updatedAt: now,
  };
}

/** A transaction contract; callers execute these statements together on one connection. */
export const backfillLockSql = "SELECT pg_try_advisory_lock(hashtext('cash_explorer.enrichment.backfill')) AS acquired";
export const checkpointUpsertSql = `INSERT INTO cash_explorer.explorer_checkpoint (id, chain_id, checkpoint_kind, block_number, block_hash, log_index, event_id, finalized, state)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
ON CONFLICT (chain_id, checkpoint_kind) DO UPDATE SET block_number=EXCLUDED.block_number, block_hash=EXCLUDED.block_hash, log_index=EXCLUDED.log_index, event_id=EXCLUDED.event_id, finalized=EXCLUDED.finalized, state=EXCLUDED.state, updated_at=now()`;
