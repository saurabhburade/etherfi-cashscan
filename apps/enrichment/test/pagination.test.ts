import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { keysetVariables } from "../src/graphql-adapter.js";

describe("keyset pagination", () =>
  it("uses all five global ordering fields", () => {
    const where = keysetVariables(
      { id: "1:0x:2", chainId: 1, timestamp: "2026-01-01T00:00:00Z", blockNumber: "10", logIndex: 2 },
      50,
    ).where as {
      _or: Array<{ id?: { _gt: string }; logIndex?: { _lt: number } }>;
    };
    assert.equal(where._or.length, 5);
    assert.equal(where._or[4]?.id?._gt, "1:0x:2");
    assert.equal(where._or[3]?.logIndex?._lt, 2);
  }));
