import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ACCOUNTS_HOLDING_TOKENS_SQL,
  EXPIRE_STALE_PRICES_SQL,
  PostgresEnrichmentStore,
  RECOMPUTE_ACCOUNT_ANALYTICS_SQL,
  RECOMPUTE_ACCOUNT_ROLLUP_SQL,
  UPSERT_ACCOUNT_TOKEN_EVENTS_SQL,
} from "../src/worker.js";

describe("PostgresEnrichmentStore", () => {
  it("orders a writable projection inside one transaction", async () => {
    const calls: string[] = [];
    const store = new PostgresEnrichmentStore(
      {
        begin: async () => {
          calls.push("begin");
        },
        commit: async () => {
          calls.push("commit");
        },
        rollback: async () => {
          calls.push("rollback");
        },
        query: async (text) => {
          calls.push(
            text.startsWith("INSERT INTO cash_explorer.account")
              ? "account"
              : text.startsWith("INSERT INTO cash_explorer.scanner_event")
                ? "event"
                : "query",
          );
          return { rows: [] };
        },
      },
      false,
    );
    await store.writeProjection({
      events: [
        {
          id: "1:0x:0",
          chainId: 1,
          transactionHash: "0x",
          blockHash: "h",
          sourceProvenance: "test",
          eventType: "spend",
          accountAddress: "0xa",
          tokenAddress: null,
          amount: null,
          amountUsd: null,
          usdDecimals: 6,
          usdStatus: "unpriced",
          accountingRole: "canonical",
          accountingDirection: "debit",
          accountingKind: "card_spend",
          metadata: {},
          timestamp: "2026-01-01T00:00:00Z",
          blockNumber: "1",
          logIndex: 0,
        },
      ],
      legs: [],
      tokens: [],
      safeBalances: [],
      priceObservations: [],
    });
    assert.deepEqual(calls.slice(0, 4), ["begin", "query", "account", "event"]);
    assert.equal(calls.at(-1), "commit");
    assert.equal(calls.filter((call) => call === "account").length, 1);
    assert.equal(calls.filter((call) => call === "event").length, 1);
  });

  it("invalidates expired prices and requires a live price for current balance valuation", () => {
    assert.match(EXPIRE_STALE_PRICES_SQL, /expires_at <= now\(\)/);
    assert.match(EXPIRE_STALE_PRICES_SQL, /price_status='unpriced'/);
    assert.match(ACCOUNTS_HOLDING_TOKENS_SQL, /account_token_metric/);
    assert.match(RECOMPUTE_ACCOUNT_ANALYTICS_SQL, /current\.expires_at>now\(\)/);
  });

  it("excludes cancelled movements from the account transaction count", () => {
    assert.match(RECOMPUTE_ACCOUNT_ROLLUP_SQL, /event\.status<>'cancelled'/);
  });

  it("persists raw uint256 cashback types and settlement attribution", () => {
    assert.match(UPSERT_ACCOUNT_TOKEN_EVENTS_SQL, /cashback_type/);
    assert.match(UPSERT_ACCOUNT_TOKEN_EVENTS_SQL, /\^\\d\+\$/);
    assert.match(UPSERT_ACCOUNT_TOKEN_EVENTS_SQL, /::numeric/);
    assert.match(UPSERT_ACCOUNT_TOKEN_EVENTS_SQL, /'settlement'/);
  });
});
