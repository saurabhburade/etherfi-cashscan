import { zeroAddress } from "viem";

/**
 * The enrichment schema is deliberately opt-in. Keeping this server-only flag
 * false means a web deploy can safely precede the indexer schema migration.
 */
export const cashExplorerSchemaEnabled = process.env.CASH_EXPLORER_SCHEMA_ENABLED === "true";

export type CashExplorerCursor = {
  timestamp: string;
  chainId: number;
  blockNumber: string;
  logIndex: number;
  id: string;
};

export type CashExplorerTokenLeg = {
  token: string;
  amount: string;
  direction: "credit" | "debit" | "neutral";
  symbol: string;
  name: string;
  decimals: number | null;
  amountUsd: number | null;
  priceStatus: string;
};

export type CashExplorerEvent = {
  id: string;
  eventType: string;
  chainId: number;
  blockNumber: string;
  logIndex: number;
  contractAddress: string;
  actor: string;
  timestamp: string;
  transactionHash: string;
  amountUsd: number | null;
  priceStatus: string;
  tokenLegs: CashExplorerTokenLeg[];
};

export type CashExplorerPage = {
  events: CashExplorerEvent[];
  nextCursor?: string;
};

/** Schema labels are canonical; legacy snake-case values retain a readable fallback. */
export function exactCashExplorerEventLabel(type: string) {
  if (type === "topup") return "Top-up";
  return type.includes("_") ? type.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()) : type;
}

type Row = Record<string, unknown>;

// Each of these operations stays bounded. They only become active after the
// additive cash_explorer schema is deployed behind the feature flag.
export const CASH_EXPLORER_LATEST_EVENTS_QUERY = /* GraphQL */ `
  query CashExplorerLatestEvents($where: ScannerEvent_bool_exp!, $limit: Int!) {
    ScannerEvent(
      where: $where
      limit: $limit
      order_by: [{ timestamp: desc }, { chainId: asc }, { blockNumber: desc }, { logIndex: desc }, { id: asc }]
    ) {
      id eventType chainId blockNumber logIndex contractAddress actorAddress timestamp transactionHash amountUsd priceStatus: usdStatus
      tokenLegs(order_by: { legIndex: asc }) {
        legIndex amount direction amountUsd priceStatus
        token { address name symbol decimals }
      }
    }
  }
`;

export const CASH_EXPLORER_EVENT_LEGS_QUERY = /* GraphQL */ `
  query CashExplorerEventLegs($where: ScannerEvent_bool_exp!, $limit: Int!) {
    ScannerEvent(where: $where, limit: $limit) {
      id
      tokenLegs(order_by: { legIndex: asc }) {
        legIndex amount direction amountUsd priceStatus
        token { address name symbol decimals }
      }
    }
  }
`;

export const CASH_EXPLORER_ACCOUNT_TOKEN_METRICS_QUERY = /* GraphQL */ `
  query CashExplorerAccountTokenMetrics($where: AccountTokenMetric_bool_exp!, $limit: Int!) {
    AccountTokenMetric(where: $where, limit: $limit, order_by: { updatedAt: desc }) {
      safeBalanceAmount safeInflowAmount safeOutflowAmount amountUsd usdStatus updatedAt
      account { address chainId }
      token { address chainId name symbol decimals }
    }
  }
`;

export const CASH_EXPLORER_TOKEN_DAY_METRICS_QUERY = /* GraphQL */ `
  query CashExplorerTokenDayMetrics($where: TokenDailyMetric_bool_exp!, $limit: Int!) {
    TokenDailyMetric(where: $where, limit: $limit, order_by: { day: desc }) {
      day eventCount creditUsd debitUsd volumeUsd usdStatus
      token { address chainId name symbol decimals }
    }
  }
`;

export const CASH_EXPLORER_PRICE_STATUS_QUERY = /* GraphQL */ `
  query CashExplorerPriceStatus($where: TokenPriceCurrent_bool_exp!, $limit: Int!) {
    TokenPriceCurrent(where: $where, limit: $limit, order_by: { updatedAt: desc }) {
      priceUsd priceStatus sourceType updatedAt
      token { address chainId name symbol decimals }
    }
  }
`;

export function encodeCashExplorerCursor(cursor: CashExplorerCursor): string {
  return btoa(JSON.stringify(cursor));
}

export function decodeCashExplorerCursor(value: string | undefined): CashExplorerCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(atob(value)) as Partial<CashExplorerCursor>;
    if (
      typeof parsed.timestamp !== "string" ||
      !Number.isInteger(parsed.chainId) ||
      typeof parsed.blockNumber !== "string" ||
      !Number.isInteger(parsed.logIndex) ||
      typeof parsed.id !== "string"
    ) {
      return undefined;
    }
    return parsed as CashExplorerCursor;
  } catch {
    return undefined;
  }
}

/** Builds the strict "after" side of the five-column global event order. */
export function cashExplorerCursorWhere(cursor: CashExplorerCursor | undefined): Row | undefined {
  if (!cursor) return undefined;
  return {
    _or: [
      { timestamp: { _lt: cursor.timestamp } },
      { timestamp: { _eq: cursor.timestamp }, chainId: { _gt: cursor.chainId } },
      {
        timestamp: { _eq: cursor.timestamp },
        chainId: { _eq: cursor.chainId },
        blockNumber: { _lt: cursor.blockNumber },
      },
      {
        timestamp: { _eq: cursor.timestamp },
        chainId: { _eq: cursor.chainId },
        blockNumber: { _eq: cursor.blockNumber },
        logIndex: { _lt: cursor.logIndex },
      },
      {
        timestamp: { _eq: cursor.timestamp },
        chainId: { _eq: cursor.chainId },
        blockNumber: { _eq: cursor.blockNumber },
        logIndex: { _eq: cursor.logIndex },
        id: { _gt: cursor.id },
      },
    ],
  };
}

export function cashExplorerEventWhere(filters: {
  query?: string;
  account?: string;
  token?: string;
  tokenScopes?: Array<{ chainId: number; token: string }>;
  chainId?: number;
  eventType?: string;
  cursor?: string;
}): Row {
  const conditions: Row[] = [];
  if (filters.chainId) conditions.push({ chainId: { _eq: filters.chainId } });
  if (filters.account) conditions.push({ actorAddress: { _eq: filters.account.toLowerCase() } });
  if (filters.token) {
    const address = filters.token.toLowerCase();
    conditions.push({ tokenLegs: { tokenAddress: { _eq: address } } });
  }
  if (filters.tokenScopes?.length) {
    conditions.push({
      _or: filters.tokenScopes.map((scope) => ({
        _and: [
          { chainId: { _eq: scope.chainId } },
          { tokenLegs: { tokenAddress: { _eq: scope.token.toLowerCase() } } },
        ],
      })),
    });
  }
  if (filters.eventType && filters.eventType !== "all") conditions.push({ eventType: { _eq: filters.eventType } });
  const query = filters.query?.trim().toLowerCase();
  if (query) {
    if (/^0x[0-9a-f]{64}$/.test(query)) conditions.push({ transactionHash: { _eq: query } });
    else if (/^0x[0-9a-f]{40}$/.test(query)) {
      conditions.push({
        _or: ["actorAddress", "contractAddress"].map((field) => ({ [field]: { _eq: query } })),
      });
    } else conditions.push({ eventType: { _eq: query } });
  }
  const cursor = cashExplorerCursorWhere(decodeCashExplorerCursor(filters.cursor));
  if (cursor) conditions.push(cursor);
  return conditions.length ? { _and: conditions } : {};
}

export function cashExplorerActivity(event: CashExplorerEvent) {
  const firstLeg = event.tokenLegs[0];
  return {
    id: event.id,
    type: event.eventType,
    chainId: event.chainId,
    blockNumber: event.blockNumber,
    contractAddress: event.contractAddress,
    actor: event.actor,
    token: firstLeg?.token ?? zeroAddress,
    amount: firstLeg?.amount ?? "0",
    amountUsd: event.amountUsd,
    amountUsdStatus: event.priceStatus,
    tokenName: firstLeg?.name ?? "",
    tokenSymbol: firstLeg?.symbol ?? "",
    tokenDecimals: firstLeg?.decimals ?? null,
    tokenCount: event.tokenLegs.length,
    tokenLegs: event.tokenLegs,
    timestamp: event.timestamp,
    transactionHash: event.transactionHash,
  };
}

function string(row: Row, key: string) {
  return String(row[key] ?? "");
}

function nullableNumber(row: Row, key: string): number | null {
  const value = row[key];
  return value === null || value === undefined ? null : Number(value);
}

/** Cash emitter and derived scanner USD values use six fixed-point decimals. */
export function cashExplorerUsd(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : null;
}

export async function loadCashExplorerPage(
  endpoint: string,
  adminSecret: string | undefined,
  filters: {
    query?: string;
    account?: string;
    token?: string;
    tokenScopes?: Array<{ chainId: number; token: string }>;
    chainId?: number;
    eventType?: string;
    cursor?: string;
    pageSize?: number;
  },
): Promise<CashExplorerPage> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(filters.pageSize ?? 10)));
  const eventsData = await graphql<{ ScannerEvent: Row[] }>(
    endpoint,
    CASH_EXPLORER_LATEST_EVENTS_QUERY,
    {
      where: cashExplorerEventWhere(filters),
      limit: pageSize + 1,
    },
    adminSecret,
  );
  const rows = eventsData.ScannerEvent.slice(0, pageSize);
  const events = rows.map((row) => {
    const tokenLegs = ((row.tokenLegs ?? []) as Row[]).map((leg) => {
      const token = (leg.token ?? {}) as Row;
      return {
        token: string(token, "address"),
        amount: string(leg, "amount"),
        direction: string(leg, "direction") as CashExplorerTokenLeg["direction"],
        amountUsd: cashExplorerUsd(leg.amountUsd),
        priceStatus: string(leg, "priceStatus"),
        symbol: string(token, "symbol"),
        name: string(token, "name"),
        decimals: nullableNumber(token, "decimals"),
      } satisfies CashExplorerTokenLeg;
    });
    return {
      id: string(row, "id"),
      eventType: string(row, "eventType"),
      chainId: Number(row.chainId),
      blockNumber: string(row, "blockNumber"),
      logIndex: Number(row.logIndex),
      contractAddress: string(row, "contractAddress"),
      actor: string(row, "actorAddress"),
      timestamp: string(row, "timestamp"),
      transactionHash: string(row, "transactionHash"),
      amountUsd: cashExplorerUsd(row.amountUsd),
      priceStatus: string(row, "priceStatus"),
      tokenLegs,
    } satisfies CashExplorerEvent;
  });
  const last = events.at(-1);
  return {
    events,
    nextCursor:
      eventsData.ScannerEvent.length > pageSize && last
        ? encodeCashExplorerCursor({
            timestamp: last.timestamp,
            chainId: last.chainId,
            blockNumber: last.blockNumber,
            logIndex: last.logIndex,
            id: last.id,
          })
        : undefined,
  };
}

async function graphql<T>(endpoint: string, query: string, variables: Row, adminSecret?: string): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(adminSecret ? { "x-hasura-admin-secret": adminSecret } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || payload.errors?.length || !payload.data)
    throw new Error(payload.errors?.[0]?.message ?? "Cash Explorer GraphQL request failed");
  return payload.data;
}
