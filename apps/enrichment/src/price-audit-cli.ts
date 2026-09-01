import { auditPriceCoverage, type PriceAuditMovement } from "./price-audit.js";

type Row = Record<string, unknown>;
const RANGE_QUERY = `query PriceCoverage($chainId:Int!,$fromBlock:numeric!,$toBlock:numeric!,$limit:Int!){
  SpendTokenValuation(where:{chainId:{_eq:$chainId},blockNumber:{_gte:$fromBlock,_lte:$toBlock}},limit:$limit,order_by:[{blockNumber:asc},{logIndex:asc},{id:asc}]){chainId tokenAddress amount amountUsd priceUsdE18 priceStatus blockNumber transactionHash}
  TopUp(where:{chainId:{_eq:$chainId},blockNumber:{_gte:$fromBlock,_lte:$toBlock}},limit:$limit,order_by:[{blockNumber:asc},{logIndex:asc},{id:asc}]){chainId tokenAddress amount blockNumber transactionHash}
  Repayment(where:{chainId:{_eq:$chainId},blockNumber:{_gte:$fromBlock,_lte:$toBlock}},limit:$limit,order_by:[{blockNumber:asc},{logIndex:asc},{id:asc}]){chainId tokenAddress amount amountUsd blockNumber transactionHash}
  DebtEvent(where:{chainId:{_eq:$chainId},blockNumber:{_gte:$fromBlock,_lte:$toBlock}},limit:$limit,order_by:[{blockNumber:asc},{logIndex:asc},{id:asc}]){chainId tokenAddress amount amountUsd usdStatus eventType blockNumber transactionHash}
  Cashback(where:{chainId:{_eq:$chainId},blockNumber:{_gte:$fromBlock,_lte:$toBlock}},limit:$limit,order_by:[{blockNumber:asc},{logIndex:asc},{id:asc}]){chainId tokenAddress amount amountUsd blockNumber transactionHash}
  WithdrawalEvent(where:{chainId:{_eq:$chainId},blockNumber:{_gte:$fromBlock,_lte:$toBlock}},limit:$limit,order_by:[{blockNumber:asc},{logIndex:asc},{id:asc}]){chainId tokens amounts status blockNumber transactionHash}
  PriceFeedUpdate(where:{chainId:{_eq:$chainId},blockNumber:{_gte:$fromBlock,_lte:$toBlock}},limit:$limit,order_by:[{blockNumber:asc},{logIndex:asc},{id:asc}]){chainId feedAddress answer decimals blockNumber timestamp}
}`;

const TOKEN_QUERY = `query AuditTokens($chainId:Int!,$addresses:[String!]!){Token(where:{chainId:{_eq:$chainId},address:{_in:$addresses}},limit:1000){chainId address symbol decimalsVerified metadataStatus oracleAddress oraclePair price latestSpendPriceUsdE18}}`;

const numberFlag = (name: string, fallback?: number) => {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const value = raw == null ? fallback : Number(raw);
  if (value == null || !Number.isInteger(value) || value < 0)
    throw new Error(`--${name} is required and must be an integer`);
  return value;
};
const chainId = numberFlag("chain-id");
const fromBlock = numberFlag("from-block");
const toBlock = numberFlag("to-block");
const limit = numberFlag("limit", 5_000);
if (toBlock < fromBlock) throw new Error("--to-block must be greater than or equal to --from-block");

const endpoint = process.env.ENVIO_GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";
const adminSecret = process.env.ENVIO_HASURA_ADMIN_SECRET;
const range = await graphql<{
  SpendTokenValuation: Row[];
  TopUp: Row[];
  Repayment: Row[];
  DebtEvent: Row[];
  Cashback: Row[];
  WithdrawalEvent: Row[];
  PriceFeedUpdate: Row[];
}>(RANGE_QUERY, { chainId, fromBlock: String(fromBlock), toBlock: String(toBlock), limit: limit + 1 });

for (const [entity, rows] of Object.entries(range)) {
  if (entity !== "PriceFeedUpdate" && rows.length > limit) {
    throw new Error(`${entity} exceeded --limit=${limit}; use a narrower block range so the audit is complete`);
  }
}

const movements: PriceAuditMovement[] = [
  ...range.SpendTokenValuation.slice(0, limit).map((row) => movement("spend", row, row.priceUsdE18)),
  ...range.TopUp.slice(0, limit).map((row) => movement("topup", row)),
  ...range.Repayment.slice(0, limit).map((row) => movement("repayment", row)),
  ...range.DebtEvent.slice(0, limit).map((row) => movement(String(row.eventType), row)),
  ...range.Cashback.slice(0, limit).map((row) => movement("cashback", row)),
  ...range.WithdrawalEvent.slice(0, limit).flatMap((row) =>
    stringArray(row.tokens).map((tokenAddress, index) => ({
      category: `withdrawal_${String(row.status)}`,
      chainId: Number(row.chainId),
      tokenAddress,
      amountRaw: stringArray(row.amounts)[index] ?? "0",
      amountUsdRaw: null,
      transactionHash: String(row.transactionHash),
    })),
  ),
];
const addresses = [...new Set(movements.map((row) => row.tokenAddress.toLowerCase()))];
const metadata = addresses.length
  ? await graphql<{ Token: Row[] }>(TOKEN_QUERY, { chainId, addresses })
  : { Token: [] };
const report = auditPriceCoverage(
  movements,
  metadata.Token.map((row) => ({
    chainId: Number(row.chainId),
    address: String(row.address),
    symbol: String(row.symbol),
    decimalsVerified: Boolean(row.decimalsVerified),
    metadataStatus: String(row.metadataStatus),
    oracleAddress: String(row.oracleAddress),
    oraclePair: String(row.oraclePair),
    price: String(row.price),
    latestSpendPriceUsdE18: String(row.latestSpendPriceUsdE18),
  })),
  range.PriceFeedUpdate.slice(0, limit).map((row) => ({
    chainId: Number(row.chainId),
    feedAddress: String(row.feedAddress),
    answer: String(row.answer),
  })),
);

console.log(JSON.stringify({ range: { chainId, fromBlock, toBlock }, ...report }, null, 2));
if (process.argv.includes("--strict") && !report.summary.allHistoricalEventsPriced) process.exitCode = 2;

function movement(category: string, row: Row, explicitPriceUsdE18?: unknown): PriceAuditMovement {
  return {
    category,
    chainId: Number(row.chainId),
    tokenAddress: String(row.tokenAddress),
    amountRaw: String(row.amount),
    amountUsdRaw: row.amountUsd == null ? null : String(row.amountUsd),
    explicitPriceUsdE18: explicitPriceUsdE18 == null ? null : String(explicitPriceUsdE18),
    valuationStatus: String(row.priceStatus ?? row.usdStatus ?? ""),
    transactionHash: String(row.transactionHash),
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(adminSecret ? { "x-hasura-admin-secret": adminSecret } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || payload.errors?.length || !payload.data)
    throw new Error(payload.errors?.map((error) => error.message).join("; ") || `GraphQL HTTP ${response.status}`);
  return payload.data;
}
