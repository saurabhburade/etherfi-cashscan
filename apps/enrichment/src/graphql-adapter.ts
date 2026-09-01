import { canonicalEventId, normalizeAddress } from "./ids.js";
import type { EventCursor, SourceAdapter, SourcePage } from "./types.js";

export type GraphqlTransport = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }>;

/** Bounded GraphQL reads only. The adapter deliberately has no RPC capability. */
export function createGraphqlSourceAdapter(transport: GraphqlTransport): SourceAdapter {
  return {
    async fetchPage(after, limit): Promise<SourcePage> {
      const result = await transport(SOURCE_PAGE_QUERY, keysetVariables(after, limit));
      assertGraphql(result);
      const protocolEvents = array(result.data?.ProtocolEvent).map(parseProtocolEvent);
      const hashes = [...new Set(protocolEvents.map((row) => row.transactionHash))];
      const detail = hashes.length ? await transport(SOURCE_DETAIL_QUERY, { hashes }) : { data: {} };
      assertGraphql(detail);
      const data = detail.data ?? {};
      const sourceKeys = new Set(
        protocolEvents.map((row) => canonicalEventId(row.chainId, row.transactionHash, row.logIndex)),
      );
      const belongsToPage = (row: Record<string, unknown>) =>
        sourceKeys.has(canonicalEventId(Number(row.chainId), String(row.transactionHash), Number(row.logIndex)));
      const spends = array(data.Spend).filter(belongsToPage).map(parseSpend);
      const spendIds = new Set(spends.map((row) => row.id));
      const spendLegs = array(data.SpendTokenValuation)
        .filter((row) => spendIds.has(String(row.spendId)))
        .map(parseLeg);
      const topUps = array(data.TopUp).filter(belongsToPage).map(parseTopUp);
      const repayments = array(data.Repayment).filter(belongsToPage).map(parseRepayment);
      const debtEvents = array(data.DebtEvent).filter(belongsToPage).map(parseDebt);
      const cashback = array(data.Cashback).filter(belongsToPage).map(parseCashback);
      const withdrawals = array(data.WithdrawalEvent).filter(belongsToPage).map(parseWithdrawal);
      const priceFeeds = array(data.PriceFeedUpdate).filter(belongsToPage).map(parsePriceFeed);

      const tokenIds = new Set<string>();
      const balanceIds = new Set<string>();
      const add = (chainId: number, token: string | null | undefined, account?: string | null) => {
        if (!token || /^0x0{40}$/i.test(token)) return;
        const id = `${chainId}:${normalizeAddress(token)}`;
        tokenIds.add(id);
        if (account && !/^0x0{40}$/i.test(account))
          balanceIds.add(`${chainId}:${normalizeAddress(account)}:${normalizeAddress(token)}`);
      };
      for (const row of protocolEvents) add(row.chainId, row.tokenAddress, row.actor);
      for (const row of spendLegs) {
        const spend = spends.find((candidate) => candidate.id === row.spendId);
        add(spend?.chainId ?? 0, row.tokenAddress, spend?.safe);
      }
      for (const row of topUps) add(row.chainId, row.tokenAddress, row.tradingSafe || row.user);
      for (const row of repayments) add(row.chainId, row.tokenAddress, row.safe);
      for (const row of debtEvents) add(row.chainId, row.tokenAddress, row.user);
      for (const row of cashback) add(row.chainId, row.tokenAddress, row.safe);
      for (const row of withdrawals)
        row.tokens.forEach((token) => {
          add(row.chainId, token, row.safe);
        });

      const state =
        tokenIds.size || balanceIds.size
          ? await transport(SOURCE_STATE_QUERY, { tokenIds: [...tokenIds], balanceIds: [...balanceIds] })
          : { data: {} };
      assertGraphql(state);
      return {
        protocolEvents,
        spends,
        spendLegs,
        topUps,
        repayments,
        debtEvents,
        cashback,
        withdrawals,
        safeBalances: array(state.data?.SafeTokenBalance).map(parseBalance),
        tokens: array(state.data?.Token).map(parseToken),
        priceFeeds,
      };
    },
  };
}

function assertGraphql(result: { errors?: Array<{ message: string }> }) {
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
}
const array = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
const parsed = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" ? JSON.parse(value) : [];
const parsedNullable = (value: unknown): Array<string | null> =>
  Array.isArray(value)
    ? value.map((entry) => (entry == null ? null : String(entry)))
    : typeof value === "string"
      ? JSON.parse(value)
      : [];
const event = (row: Record<string, unknown>) => ({
  id: String(row.id),
  chainId: Number(row.chainId),
  transactionHash: String(row.transactionHash),
  logIndex: Number(row.logIndex),
  blockNumber: String(row.blockNumber),
  timestamp: String(row.timestamp),
});
const parseProtocolEvent = (row: Record<string, unknown>) => ({
  ...event(row),
  contractAddress: String(row.contractAddress),
  eventType: String(row.eventType),
  actor: String(row.actor),
  tokenAddress: String(row.tokenAddress),
  amount: String(row.amount),
  amountUsd: row.amountUsd == null ? null : String(row.amountUsd),
  metadata: String(row.metadata),
});
const parseSpend = (row: Record<string, unknown>) => ({
  ...event(row),
  safe: String(row.safe),
  txId: String(row.txId),
  mode: Number(row.mode),
  totalUsd: row.totalUsd == null ? null : String(row.totalUsd),
  usdDecimals: Number(row.usdDecimals),
  tokens: parsed(row.tokens),
  amounts: parsed(row.amounts),
  amountsUsd: parsedNullable(row.amountsUsd),
  dataAvailability: String(row.dataAvailability),
});
const parseLeg = (row: Record<string, unknown>) => ({
  spendId: String(row.spendId),
  tokenIndex: Number(row.tokenIndex),
  tokenAddress: String(row.tokenAddress),
  amount: String(row.amount),
  amountUsd: row.amountUsd == null ? null : String(row.amountUsd),
  tokenDecimals: Number(row.tokenDecimals),
  usdDecimals: Number(row.usdDecimals),
  priceUsdE18: row.priceUsdE18 == null ? null : String(row.priceUsdE18),
  priceStatus: String(row.priceStatus),
});
const parseTopUp = (row: Record<string, unknown>) => ({
  ...event(row),
  user: String(row.user),
  tradingSafe: String(row.tradingSafe),
  tokenAddress: String(row.tokenAddress),
  amount: String(row.amount),
  sourceChainId: String(row.sourceChainId),
  txId: String(row.txId),
  status: String(row.status),
});
const parseRepayment = (row: Record<string, unknown>) => ({
  ...event(row),
  safe: String(row.safe),
  tokenAddress: String(row.tokenAddress),
  amount: String(row.amount),
  amountUsd: row.amountUsd == null ? null : String(row.amountUsd),
  repaymentType: String(row.repaymentType) as "repay" | "repay_debt_manager" | "repay_lend_token_amount",
});
const parseDebt = (row: Record<string, unknown>) => ({
  ...event(row),
  user: String(row.user),
  payer: String(row.payer),
  tokenAddress: String(row.tokenAddress),
  amount: String(row.amount),
  amountUsd: row.amountUsd == null || String(row.usdStatus).includes("unpriced") ? null : String(row.amountUsd),
  usdStatus: String(row.usdStatus),
  eventType: String(row.eventType),
});
const parseCashback = (row: Record<string, unknown>) => ({
  ...event(row),
  safe: String(row.safe),
  recipient: String(row.recipient),
  tokenAddress: String(row.tokenAddress),
  amount: String(row.amount),
  amountUsd: row.amountUsd == null ? null : String(row.amountUsd),
  spendingUsd: row.spendingUsd == null ? null : String(row.spendingUsd),
  paid: Boolean(row.paid),
  cashbackType: String(row.cashbackType),
});
const parseWithdrawal = (row: Record<string, unknown>) => ({
  ...event(row),
  safe: String(row.safe),
  recipient: String(row.recipient),
  tokens: parsed(row.tokens),
  amounts: parsed(row.amounts),
  status: String(row.status),
  finalizeTimestamp: String(row.finalizeTimestamp),
});
const parseBalance = (row: Record<string, unknown>) => ({
  chainId: Number(row.chainId),
  safeAddress: String(row.safeAddress),
  tokenAddress: String(row.tokenAddress),
  amount: String(row.amount),
  inflow: String(row.inflow),
  outflow: String(row.outflow),
  updatedAt: String(row.updatedAt),
  updatedBlock: String(row.updatedBlock),
  transactionHash: String(row.transactionHash),
});
const parseToken = (row: Record<string, unknown>) => ({
  chainId: Number(row.chainId),
  address: String(row.address),
  name: String(row.name),
  symbol: String(row.symbol),
  decimals: Number(row.decimals),
  decimalsVerified: Boolean(row.decimalsVerified),
  metadataStatus: String(row.metadataStatus),
  oracleAddress: String(row.oracleAddress),
  oraclePair: String(row.oraclePair),
  oracleDecimals: Number(row.oracleDecimals),
});
const parsePriceFeed = (row: Record<string, unknown>) => ({
  ...event(row),
  feedAddress: String(row.feedAddress),
  pair: String(row.pair),
  answer: String(row.answer),
  decimals: Number(row.decimals),
  roundId: String(row.roundId),
  updatedAt: String(row.updatedAt),
});

export function keysetVariables(after: EventCursor | null, limit: number) {
  return {
    limit,
    where: after
      ? {
          _or: [
            { timestamp: { _lt: after.timestamp } },
            { timestamp: { _eq: after.timestamp }, chainId: { _gt: after.chainId } },
            {
              timestamp: { _eq: after.timestamp },
              chainId: { _eq: after.chainId },
              blockNumber: { _lt: after.blockNumber },
            },
            {
              timestamp: { _eq: after.timestamp },
              chainId: { _eq: after.chainId },
              blockNumber: { _eq: after.blockNumber },
              logIndex: { _lt: after.logIndex },
            },
            {
              timestamp: { _eq: after.timestamp },
              chainId: { _eq: after.chainId },
              blockNumber: { _eq: after.blockNumber },
              logIndex: { _eq: after.logIndex },
              id: { _gt: after.id },
            },
          ],
        }
      : {},
  };
}

export const SOURCE_PAGE_QUERY = `query Page($limit:Int!,$where:ProtocolEvent_bool_exp!){ProtocolEvent(limit:$limit,where:$where,order_by:[{timestamp:desc},{chainId:asc},{blockNumber:desc},{logIndex:desc},{id:asc}]){id chainId contractAddress eventType actor tokenAddress amount amountUsd blockNumber timestamp transactionHash logIndex metadata}}`;
export const SOURCE_DETAIL_QUERY = `query Detail($hashes:[String!]!){Spend(where:{transactionHash:{_in:$hashes}}){id chainId transactionHash logIndex blockNumber timestamp safe txId mode totalUsd usdDecimals tokens amounts amountsUsd dataAvailability} SpendTokenValuation(where:{transactionHash:{_in:$hashes}}){spendId tokenIndex tokenAddress amount amountUsd tokenDecimals usdDecimals priceUsdE18 priceStatus} TopUp(where:{transactionHash:{_in:$hashes}}){id chainId transactionHash logIndex blockNumber timestamp user tradingSafe tokenAddress amount sourceChainId txId status} Repayment(where:{transactionHash:{_in:$hashes}}){id chainId transactionHash logIndex blockNumber timestamp safe tokenAddress amount amountUsd repaymentType} DebtEvent(where:{transactionHash:{_in:$hashes}}){id chainId transactionHash logIndex blockNumber timestamp user payer tokenAddress amount amountUsd usdStatus eventType} Cashback(where:{transactionHash:{_in:$hashes}}){id chainId transactionHash logIndex blockNumber timestamp safe recipient tokenAddress amount amountUsd spendingUsd paid cashbackType} WithdrawalEvent(where:{transactionHash:{_in:$hashes}}){id chainId transactionHash logIndex blockNumber timestamp safe recipient tokens amounts status finalizeTimestamp} PriceFeedUpdate(where:{transactionHash:{_in:$hashes}}){id chainId transactionHash logIndex blockNumber timestamp feedAddress pair answer decimals roundId updatedAt}}`;
export const SOURCE_STATE_QUERY = `query State($tokenIds:[String!]!,$balanceIds:[String!]!){Token(where:{id:{_in:$tokenIds}}){chainId address name symbol decimals decimalsVerified metadataStatus oracleAddress oraclePair oracleDecimals} SafeTokenBalance(where:{id:{_in:$balanceIds}}){chainId safeAddress tokenAddress amount inflow outflow updatedAt updatedBlock transactionHash}}`;
