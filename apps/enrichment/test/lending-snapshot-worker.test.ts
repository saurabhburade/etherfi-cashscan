import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CANDIDATE_SQL, runLendingSnapshotBatch } from "../src/lending-snapshot-worker.js";
import type { SqlExecutor } from "../src/worker.js";

const candidate = {
  chain_id: 10,
  safe_address: "0x0000000000000000000000000000000000000001",
  spoke_address: "0x0000000000000000000000000000000000000002",
  block_number: "100",
  trigger: "risk",
  reserves: [
    { reserveId: "1", tokenAddress: "0x0000000000000000000000000000000000000003" },
    { reserveId: "2", tokenAddress: "0x0000000000000000000000000000000000000004" },
  ],
};

function executor(rows: Array<Record<string, unknown>>): SqlExecutor {
  return {
    begin: async () => {},
    commit: async () => {},
    rollback: async () => {},
    query: async () => ({ rows }),
  };
}

describe("lending snapshot worker", () => {
  it("derives finality from the chain head and performs one exact-block multicall", async () => {
    const methods: string[] = [];
    const queryValues: unknown[][] = [];
    const sql: SqlExecutor = {
      ...executor([]),
      query: async (_text, values = []) => {
        queryValues.push(values);
        return { rows: [candidate] };
      },
    };
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      methods.push(request.method);
      if (request.method === "eth_blockNumber")
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x78" }));
      if (request.method === "eth_getBlockByNumber")
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { number: "0x64", hash: "0xblock" } }));
      assert.equal(request.method, "eth_call");
      assert.equal(request.params[1], "0x64");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "archive unavailable" } }));
    }) as typeof fetch;

    const result = await runLendingSnapshotBatch(sql, {
      chainId: 10,
      rpcUrl: "https://archive.invalid",
      confirmations: 20n,
      fetcher,
    });

    assert.equal(result.finalized, 100n);
    assert.equal(result.selected, 1);
    assert.equal(result.snapshots[0].reserves.length, 2);
    assert.equal(result.snapshots[0].blockHash, "0xblock");
    assert.deepEqual(methods, ["eth_blockNumber", "eth_getBlockByNumber", "eth_call"]);
    assert.equal(queryValues[0][1], "9223372036854775807");
    assert.equal(queryValues[1][1], "100");
  });

  it("does not touch RPC when no Safe has unsnapshotted activity", async () => {
    let calls = 0;
    const result = await runLendingSnapshotBatch(executor([]), {
      chainId: 10,
      rpcUrl: "https://archive.invalid",
      confirmations: 20n,
      fetcher: (async () => {
        calls += 1;
        throw new Error("unexpected RPC");
      }) as typeof fetch,
    });
    assert.equal(result.selected, 0);
    assert.equal(result.head, null);
    assert.equal(calls, 0);
  });

  it("coalesces normal activity by 15-minute bucket, risk by block, and loads all active reserves", () => {
    assert.match(CANDIDATE_SQL, /date_part\('minute',e\.occurred_at\)\/15/);
    assert.match(CANDIDATE_SQL, /trigger='risk' THEN block_number::text ELSE bucket::text/);
    assert.match(CANDIDATE_SQL, /NOT EXISTS/);
    assert.match(CANDIDATE_SQL, /r\.market_id=p\.market_id AND r\.is_active/);
    assert.doesNotMatch(CANDIDATE_SQL, /e\.finality_status='finalized'/);
  });
});
