import { type Checkpoint, checkpointAfter, nextRange } from "./cursor.js";
import { compareGlobalOrder } from "./ids.js";
import { projectPage } from "./projector.js";
import type { SourceAdapter } from "./types.js";

export type BackfillStore = {
  tryAdvisoryLock(): Promise<boolean>;
  readCheckpoint(name: string): Promise<Checkpoint | null>;
  writeProjection(projection: ReturnType<typeof projectPage>): Promise<void>;
  writeCheckpoint(checkpoint: Checkpoint): Promise<void>;
};
export async function runBackfill(
  adapter: SourceAdapter,
  store: BackfillStore,
  name = "cash-explorer-enrichment",
  limit = 500,
): Promise<{ processed: number; checkpoint: Checkpoint | null; locked: boolean }> {
  if (!(await store.tryAdvisoryLock())) return { processed: 0, checkpoint: null, locked: false };
  const prior = await store.readCheckpoint(name);
  const page = await adapter.fetchPage(nextRange(prior, limit).after, limit);
  const projection = projectPage(page);
  await store.writeProjection(projection);
  const rawFeeds = [page.protocolEvents, page.lendingSourceEvents ?? []];
  const saturatedTails = rawFeeds
    .filter((feed) => feed.length === limit)
    .flatMap((feed) => {
      const tail = feed.at(-1);
      return tail ? [tail] : [];
    });
  // Independent GraphQL limits make the newest saturated tail the only safe
  // shared boundary. The other feed may reread rows, but cannot be skipped.
  const rawRows = rawFeeds.flat();
  const last = saturatedTails.length
    ? saturatedTails.sort(compareGlobalOrder)[0]
    : (rawRows.length ? rawRows : projection.events).sort(compareGlobalOrder).at(-1);
  const checkpoint = last ? checkpointAfter(last, name) : prior;
  if (checkpoint && last) await store.writeCheckpoint(checkpoint);
  return { processed: projection.events.length + (page.lendingSourceEvents?.length ?? 0), checkpoint, locked: true };
}
