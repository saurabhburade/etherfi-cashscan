import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { LENDING_SOURCE_DETAIL_QUERY, LENDING_SOURCE_PAGE_QUERY } from "../src/graphql-adapter.js";
import { lendingPersistencePlans } from "../src/repository.js";

describe("lending raw GraphQL contract", () => {
  it("uses the V4 source fields and state lookup rather than handler finality", () => {
    for (const field of [
      "sourceAddress",
      "marketAddress",
      "spokeAddress",
      "safeAddress",
      "actorAddress",
      "recipientAddress",
      "reserveId",
      "collateralReserveId",
      "debtReserveId",
      "metadata",
    ])
      assert.match(LENDING_SOURCE_PAGE_QUERY, new RegExp(`\\b${field}\\b`));
    assert.doesNotMatch(LENDING_SOURCE_PAGE_QUERY, /\bfinalized\b|\bhubAssetId\b|\btokenAddress\b|\bprovenance\b/);
    assert.match(LENDING_SOURCE_DETAIL_QUERY, /sourceEventId/);
    assert.match(LENDING_SOURCE_DETAIL_QUERY, /reserveWhere/);
  });
  it("uses only columns defined by the lending migration", () => {
    const migrationUrl = new URL("../migrations/20260902_lending_accounting.sql", import.meta.url);
    if (!existsSync(migrationUrl)) return;
    const migration = readFileSync(migrationUrl, "utf8");
    const plans = lendingPersistencePlans({ events: [], legs: [], actions: [], actionSources: [], reserves: [] });
    assert.equal(plans.length, 0);
    for (const table of [
      "economic_action",
      "economic_action_source",
      "lending_event",
      "lending_event_leg",
      "lending_position",
      "lending_position_snapshot",
      "lending_account_snapshot",
    ])
      assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS cash_explorer\\.${table}`));
    assert.match(migration, /economic_key/);
    assert.match(migration, /source_provenance/);
    assert.match(migration, /premium_offset_ray_delta/);
  });
});
