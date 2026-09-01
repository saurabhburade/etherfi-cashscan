/** Source-shaped records read from the indexer GraphQL API. Amounts remain strings
 * at the boundary so no precision is lost before they enter the projection. */
export type EventCursor = { timestamp: string; chainId: number; blockNumber: string; logIndex: number; id: string };
export type SourceEvent = EventCursor & {
  transactionHash: string;
  blockHash?: string | null;
  sourceProvenance?: string;
};
export type TokenMetadataDto = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  decimalsVerified: boolean;
  metadataStatus: string;
  oracleAddress?: string;
  oraclePair?: string;
  oracleDecimals?: number;
};
export type SpendDto = SourceEvent & {
  safe: string;
  txId: string;
  mode: number;
  totalUsd: string | null;
  usdDecimals: number;
  tokens: string[];
  amounts: string[];
  amountsUsd: Array<string | null>;
  dataAvailability: string;
};
export type SpendTokenLegDto = {
  spendId: string;
  tokenIndex: number;
  tokenAddress: string;
  amount: string;
  amountUsd: string | null;
  tokenDecimals: number;
  usdDecimals: number;
  priceUsdE18: string | null;
  priceStatus: string;
};
export type TopUpDto = SourceEvent & {
  user: string;
  tradingSafe: string;
  tokenAddress: string;
  amount: string;
  sourceChainId: string;
  txId: string;
  status: string;
};
export type RepaymentDto = SourceEvent & {
  safe: string;
  tokenAddress: string;
  amount: string;
  amountUsd: string | null;
  repaymentType: "repay" | "repay_debt_manager" | "repay_lend_token_amount";
};
export type DebtAuditDto = SourceEvent & {
  user: string;
  payer: string;
  tokenAddress: string;
  amount: string;
  amountUsd: string | null;
  usdStatus: string;
  eventType: "lend_borrowed" | "repay_lend_token_amount" | string;
};
export type CashbackDto = SourceEvent & {
  safe: string;
  recipient: string;
  tokenAddress: string;
  amount: string;
  amountUsd: string | null;
  spendingUsd: string | null;
  paid: boolean;
  cashbackType: string;
};
export type WithdrawalDto = SourceEvent & {
  safe: string;
  recipient: string;
  tokens: string[];
  amounts: string[];
  status: "requested" | "cancelled" | "processed" | string;
  finalizeTimestamp: string;
};
export type SafeBalanceDto = {
  chainId: number;
  safeAddress: string;
  tokenAddress: string;
  amount: string;
  inflow: string;
  outflow: string;
  updatedAt: string;
  updatedBlock: string;
  transactionHash: string;
};
export type PriceFeedDto = SourceEvent & {
  feedAddress: string;
  pair: string;
  answer: string;
  decimals: number;
  roundId: string;
  updatedAt: string;
};
export type ProtocolEventDto = SourceEvent & {
  contractAddress: string;
  eventType: string;
  actor: string;
  tokenAddress: string;
  amount: string;
  amountUsd: string | null;
  metadata: string;
};

export type SourcePage = {
  protocolEvents: ProtocolEventDto[];
  spends: SpendDto[];
  spendLegs: SpendTokenLegDto[];
  topUps: TopUpDto[];
  repayments: RepaymentDto[];
  debtEvents: DebtAuditDto[];
  cashback: CashbackDto[];
  withdrawals: WithdrawalDto[];
  safeBalances: SafeBalanceDto[];
  tokens: TokenMetadataDto[];
  priceFeeds: PriceFeedDto[];
};
export type SourceAdapter = { fetchPage(after: EventCursor | null, limit: number): Promise<SourcePage> };

/** amountUsd is the exact source integer, in usdDecimals (normally 6), never a JS Number. */
export type ScannerEvent = EventCursor & {
  id: string;
  transactionHash: string;
  blockHash: string | null;
  sourceProvenance: string;
  eventType: string;
  accountAddress: string | null;
  tokenAddress: string | null;
  amount: bigint | null;
  amountUsd: bigint | null;
  usdDecimals: number;
  usdStatus: "priced" | "unpriced";
  accountingRole: "canonical" | "audit" | "duplicate";
  accountingDirection: "credit" | "debit" | "neutral" | null;
  accountingKind: string;
  metadata: Record<string, unknown>;
};
export type ScannerEventTokenLeg = {
  id: string;
  scannerEventId: string;
  tokenAddress: string;
  tokenIndex: number;
  direction: "credit" | "debit" | "neutral";
  amount: bigint;
  amountUsd: bigint | null;
  usdDecimals: number;
  usdStatus: "priced" | "unpriced";
  priceUsdE18: bigint | null;
};
export type Projection = {
  events: ScannerEvent[];
  legs: ScannerEventTokenLeg[];
  tokens: TokenMetadataDto[];
  safeBalances: SafeBalanceDto[];
  priceObservations: import("./pricing.js").PriceObservation[];
};
