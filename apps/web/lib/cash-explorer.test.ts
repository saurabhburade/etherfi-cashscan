import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CASH_EXPLORER_ACCOUNT_TOKEN_METRICS_QUERY,
  CASH_EXPLORER_EVENT_LEGS_QUERY,
  CASH_EXPLORER_LATEST_EVENTS_QUERY,
  CASH_EXPLORER_PRICE_STATUS_QUERY,
  CASH_EXPLORER_TOKEN_DAY_METRICS_QUERY,
  cashExplorerActivity,
  cashExplorerCursorWhere,
  cashExplorerEventWhere,
  cashExplorerUsd,
  decodeCashExplorerCursor,
  encodeCashExplorerCursor,
  exactCashExplorerEventLabel,
  loadCashExplorerPage,
} from "./cash-explorer";

afterEach(() => vi.unstubAllGlobals());

describe("Cash Explorer keyset cursor", () => {
  const cursor = {
    timestamp: "2026-09-01T12:00:00.000Z",
    chainId: 10,
    blockNumber: "123",
    logIndex: 4,
    id: "10:0xabc:4",
  };

  it("round trips all five ordering keys", () => {
    expect(decodeCashExplorerCursor(encodeCashExplorerCursor(cursor))).toEqual(cursor);
  });

  it("continues equal timestamps in chain, block, log, then ID order", () => {
    expect(cashExplorerCursorWhere(cursor)).toEqual({
      _or: expect.arrayContaining([
        { timestamp: { _eq: cursor.timestamp }, chainId: { _gt: 10 } },
        { timestamp: { _eq: cursor.timestamp }, chainId: { _eq: 10 }, blockNumber: { _lt: "123" } },
        {
          timestamp: { _eq: cursor.timestamp },
          chainId: { _eq: 10 },
          blockNumber: { _eq: "123" },
          logIndex: { _eq: 4 },
          id: { _gt: "10:0xabc:4" },
        },
      ]),
    });
  });
});

describe("Cash Explorer presentation contract", () => {
  it("converts indexed six-decimal USD without confusing raw units for dollars", () => {
    expect(cashExplorerUsd("4210000")).toBe(4.21);
    expect(cashExplorerUsd("0")).toBe(0);
    expect(cashExplorerUsd(null)).toBeNull();
  });

  it("preserves canonical event labels", () => {
    expect(exactCashExplorerEventLabel("LendBorrowed")).toBe("LendBorrowed");
    expect(exactCashExplorerEventLabel("repay_debt_manager")).toBe("Repay Debt Manager");
    expect(exactCashExplorerEventLabel("topup")).toBe("Top-up");
  });

  it("keeps every token leg and represents unpriced USD as null", () => {
    const activity = cashExplorerActivity({
      id: "10:0xabc:4",
      eventType: "SpendSettled",
      chainId: 10,
      blockNumber: "123",
      logIndex: 4,
      contractAddress: "0x0000000000000000000000000000000000000001",
      actor: "0x0000000000000000000000000000000000000002",
      timestamp: "2026-09-01T12:00:00.000Z",
      transactionHash: "0xabc",
      amountUsd: null,
      priceStatus: "unpriced",
      tokenLegs: [
        {
          token: "0x0000000000000000000000000000000000000003",
          amount: "1000000",
          direction: "debit",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          amountUsd: null,
          priceStatus: "unpriced",
        },
        {
          token: "0x0000000000000000000000000000000000000004",
          amount: "2000000",
          direction: "credit",
          symbol: "USDT",
          name: "Tether",
          decimals: 6,
          amountUsd: 2,
          priceStatus: "priced",
        },
      ],
    });
    expect(activity.tokenLegs).toHaveLength(2);
    expect(activity.amountUsd).toBeNull();
    expect(activity.amountUsdStatus).toBe("unpriced");
    expect(activity.tokenLegs?.[0]?.amountUsd).toBeNull();
  });
});

describe("Cash Explorer server filters", () => {
  it("uses normalized address columns for the exact address filter", () => {
    const address = "0x0000000000000000000000000000000000000001";
    expect(cashExplorerEventWhere({ query: address })).toEqual({
      _and: [
        {
          _or: [{ actorAddress: { _eq: address } }, { contractAddress: { _eq: address } }],
        },
      ],
    });
  });

  it("keeps an account scope independent from interactive transaction filters", () => {
    const account = "0x0000000000000000000000000000000000000001";
    expect(cashExplorerEventWhere({ account, eventType: "SpendSettled" })).toEqual({
      _and: [{ actorAddress: { _eq: account } }, { eventType: { _eq: "SpendSettled" } }],
    });
  });

  it("filters token details through normalized token legs", () => {
    expect(
      cashExplorerEventWhere({
        chainId: 10,
        token: "0x5A7fACB970d094B6c7FF1dF0ea68D99E6e73cBfF",
      }),
    ).toEqual({
      _and: [
        { chainId: { _eq: 10 } },
        {
          tokenLegs: {
            tokenAddress: { _eq: "0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff" },
          },
        },
      ],
    });
  });

  it("combines cumulative token contracts without losing their chain identity", () => {
    expect(
      cashExplorerEventWhere({
        tokenScopes: [
          { chainId: 10, token: "0x0000000000000000000000000000000000000001" },
          { chainId: 534352, token: "0x0000000000000000000000000000000000000002" },
        ],
      }),
    ).toEqual({
      _and: [
        {
          _or: [
            {
              _and: [
                { chainId: { _eq: 10 } },
                {
                  tokenLegs: {
                    tokenAddress: { _eq: "0x0000000000000000000000000000000000000001" },
                  },
                },
              ],
            },
            {
              _and: [
                { chainId: { _eq: 534352 } },
                {
                  tokenLegs: {
                    tokenAddress: { _eq: "0x0000000000000000000000000000000000000002" },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe("Cash Explorer bounded query contract", () => {
  it("requests event legs, aggregate metrics, and current price status without history scans", () => {
    expect(CASH_EXPLORER_LATEST_EVENTS_QUERY).toContain("limit: $limit");
    expect(CASH_EXPLORER_LATEST_EVENTS_QUERY).toContain("actorAddress");
    expect(CASH_EXPLORER_LATEST_EVENTS_QUERY).not.toContain("tokenLegs");
    expect(CASH_EXPLORER_EVENT_LEGS_QUERY).toContain("ScannerEventTokenLeg");
    expect(CASH_EXPLORER_EVENT_LEGS_QUERY).toContain("$scannerEventIds: [String!]!");
    expect(CASH_EXPLORER_EVENT_LEGS_QUERY).toContain("scannerEvent_id: { _in: $scannerEventIds }");
    expect(CASH_EXPLORER_EVENT_LEGS_QUERY).toContain("order_by: [{ scannerEvent_id: asc }, { legIndex: asc }]");
    expect(CASH_EXPLORER_EVENT_LEGS_QUERY).toContain("token { address name symbol decimals }");
    expect(CASH_EXPLORER_EVENT_LEGS_QUERY).not.toContain("tokenAddress");
    expect(CASH_EXPLORER_ACCOUNT_TOKEN_METRICS_QUERY).toContain("AccountTokenMetric(where: $where, limit: $limit");
    expect(CASH_EXPLORER_ACCOUNT_TOKEN_METRICS_QUERY).toContain(
      "safeBalanceAmount safeInflowAmount safeOutflowAmount amountUsd usdStatus updatedAt",
    );
    expect(CASH_EXPLORER_TOKEN_DAY_METRICS_QUERY).toContain("TokenDailyMetric(where: $where, limit: $limit");
    expect(CASH_EXPLORER_TOKEN_DAY_METRICS_QUERY).toContain("eventCount creditUsd debitUsd volumeUsd usdStatus");
    expect(CASH_EXPLORER_PRICE_STATUS_QUERY).toContain("TokenPriceCurrent(where: $where, limit: $limit");
    expect(CASH_EXPLORER_PRICE_STATUS_QUERY).toContain("priceUsd priceStatus sourceType updatedAt");
  });
});

describe("Cash Explorer event-leg batching", () => {
  const event = (id: string, logIndex: number) => ({
    id,
    eventType: "SpendSettled",
    chainId: 10,
    blockNumber: "123",
    logIndex,
    contractAddress: "0x0000000000000000000000000000000000000001",
    actorAddress: "0x0000000000000000000000000000000000000002",
    timestamp: "2026-09-01T12:00:00.000Z",
    transactionHash: "0xabc",
    amountUsd: "1000000",
    priceStatus: "priced",
  });

  const leg = (scannerEventId: string, legIndex: number, symbol: string) => ({
    scannerEvent_id: scannerEventId,
    legIndex,
    amount: "1000000",
    direction: "debit",
    amountUsd: "1000000",
    priceStatus: "priced",
    token: { address: `0x${legIndex}`.padEnd(42, "0"), name: `${symbol} Coin`, symbol, decimals: 6 },
  });

  it("fetches headers once and groups one batched leg response for the selected page", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
        calls.push(request);
        const data = request.query.includes("ScannerEventTokenLeg")
          ? { ScannerEventTokenLeg: [leg("event-1", 0, "USDC"), leg("event-1", 1, "USDT"), leg("event-2", 0, "DAI")] }
          : { ScannerEvent: [event("event-1", 3), event("event-2", 2), event("event-3", 1)] };
        return new Response(JSON.stringify({ data }), { status: 200 });
      }),
    );

    const page = await loadCashExplorerPage("https://indexer.example/graphql", "secret", { pageSize: 2 });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.variables).toMatchObject({ limit: 3, where: {} });
    expect(calls[1]?.variables).toEqual({ scannerEventIds: ["event-1", "event-2"] });
    expect(page.events.map((item) => item.tokenLegs.map((tokenLeg) => tokenLeg.symbol))).toEqual([
      ["USDC", "USDT"],
      ["DAI"],
    ]);
    expect(page.events[0]?.amountUsd).toBe(1);
    expect(decodeCashExplorerCursor(page.nextCursor)).toEqual({
      timestamp: "2026-09-01T12:00:00.000Z",
      chainId: 10,
      blockNumber: "123",
      logIndex: 2,
      id: "event-2",
    });
  });

  it("does not request event legs for an empty page", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { ScannerEvent: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCashExplorerPage("https://indexer.example/graphql", undefined, {})).resolves.toEqual({
      events: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
