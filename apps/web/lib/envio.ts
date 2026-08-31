import { zeroAddress } from "viem";
import { fixedPoint } from "./format";

export type Activity = {
  id: string;
  type: string;
  chainId: number;
  blockNumber: string;
  contractAddress: string;
  actor: string;
  token: string;
  amount: string;
  amountUsd: number;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number | null;
  tokenCount: number;
  timestamp: string;
  transactionHash: string;
};

export type DailyAnalytics = {
  day: string;
  spendUsd: number;
  transactions: number;
  activeCards: number;
  newCards: number;
  topUps: number;
  cashbackUsd: number;
  onrampUsd: number;
  offrampUsd: number;
  borrowedUsd: number;
  repaidUsd: number;
  cumulativeSpendUsd: number;
  cumulativeTransactions: number;
  cumulativeCards: number;
};

export type SpendProfile = {
  bucket: string;
  sortOrder: number;
  spendCount: number;
  spendUsd: number;
};

export type HourlyActivity = { hour: number; spendCount: number; spendUsd: number };
export type RampToken = { label: string; token: string; tokenSymbol: string; amountUsd: number };
export type DebtToken = {
  token: string;
  tokenSymbol: string;
  borrowedUsd: number;
  repaidUsd: number;
  outstandingUsd: number;
};
export type Coverage = {
  key: string;
  label: string;
  status: "live" | "derived" | "pending" | "offchain";
  source: string;
  note: string;
};
export type TokenBalance = {
  chainId: number;
  account: string;
  accountKind: string;
  token: string;
  amount: string;
  symbol: string;
  decimals: number | null;
  amountUsd: number | null;
};
export type SafeAccountBalance = {
  chainId: number;
  safe: string;
  token: string;
  amount: string;
  inflow: string;
  outflow: string;
  tokenName: string;
  symbol: string;
  decimals: number | null;
  amountUsd: number | null;
  updatedAt: string;
  updatedBlock: string;
  transactionHash: string;
};
export type SafeAccountsData = {
  mode: "live" | "empty" | "error";
  errorMessage?: string;
  balances: SafeAccountBalance[];
  accountCount: number;
  positionCount: number;
  pricedPositionCount: number;
  totalUsd: number;
  complete: boolean;
};
export type TopUpRecipient = {
  chainId: number;
  account: string;
  topUpCount: number;
};
export type CashbackReceiver = {
  chainId: number;
  account: string;
  rewardCount: number;
  amountUsd: number;
};

export type TokenAnalyticsRow = {
  chainId: number;
  token: string;
  name: string;
  symbol: string;
  decimals: number | null;
  spendCount: number;
  spendUsd: number;
  topUpCount: number;
  topUpAmount: string;
  topUpUsd: number | null;
  withdrawalCount: number;
  safeAccountCount: number;
  safeInflow: string;
  safeOutflow: string;
  destinationCount: number;
  reserveBalance: string;
  reserveUsd: number | null;
  destinationCredits: string;
  destinationDebits: string;
  suppliedCount: number;
  suppliedAmount: string;
  borrowedCount: number;
  borrowedAmount: string;
  borrowedUsd: number;
  repaidCount: number;
  repaidAmount: string;
  repaidUsd: number;
};

export type ExplorerData = {
  mode: "live" | "empty" | "error";
  errorMessage?: string;
  activeCardCount: number;
  spendCount: number;
  spendUsd: number;
  topUpCount: number;
  cashbackCount: number;
  cashbackUsd: number;
  onrampUsd: number;
  offrampUsd: number;
  combinedRampUsd: number;
  borrowedUsd: number;
  repaidUsd: number;
  outstandingDebtUsd: number;
  borrowerCount: number;
  daily: DailyAnalytics[];
  spendProfiles: SpendProfile[];
  hourly: HourlyActivity[];
  balances: TokenBalance[];
  topUpRecipients: TopUpRecipient[];
  cashbackReceivers: CashbackReceiver[];
  activity: Activity[];
  rampTokens: RampToken[];
  debtTokens: DebtToken[];
  tierDistribution: Array<{ tierId: number; safeCount: number }>;
  tierTransitions: Array<{
    day: string;
    fromTierId: number | null;
    toTierId: number;
    count: number;
    transitionKind: string;
  }>;
  modeDistribution: Array<{ modeId: number; safeCount: number }>;
  modeChanges: Array<{ day: string; previousModeId: number; newModeId: number; count: number }>;
  lendSummary: { active: number; pendingOptOut: number; optedOut: number };
  pendingActions: {
    withdrawals: number;
    cashbackUsd: number;
    modeChanges: number;
    spendingLimitChanges: number;
    lendOptOuts: number;
  };
  safeCashStates: Array<{
    chainId: number;
    safe: string;
    tierId: number | null;
    currentModeId: number | null;
    pendingModeId: number | null;
    modeActivationTime: string;
    lendStatus: string;
    lendFinalizeTime: string;
    dailyLimitUsd: number | null;
    monthlyLimitUsd: number | null;
    spentTodayUsd: number | null;
    spentThisMonthUsd: number | null;
    pendingWithdrawal: boolean;
  }>;
  creditSpendUsd: number;
  debitSpendUsd: number;
  collateralResupplyCount: number;
  lendSupplyFailureCount: number;
  cashConfiguration: Array<{ chainId: number; key: string; subkey: string; value: string; updatedAt: string }>;
  coverage: Coverage[];
  updatedAt: string;
};

// Envio exposes list queries for entities. Totals are calculated from those
// indexed rows here; no Dune result or fixture is used at runtime.
const CORE_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerCore(
    $activeSafeWhere: ActiveSafe_bool_exp!
    $dailyWhere: DailyCashMetric_bool_exp!
    $balanceWhere: AccountTokenBalance_bool_exp!
  ) {
    ActiveSafe_aggregate(where: $activeSafeWhere) { aggregate { count } }
    DailyCashMetric(limit: 6000, where: $dailyWhere, order_by: { day: desc }) {
      day
      spendCount
      spendUsd
      activeCardCount
      newCardCount
      topUpCount
    }
    AccountTokenBalance(
      limit: 40
      where: { _and: [{ amount: { _gt: "0" } }, $balanceWhere] }
      order_by: { amount: desc }
    ) {
      chainId
      accountAddress
      accountKind
      tokenAddress
      amount
    }
  }
`;

const GLOBAL_ACTIVE_SAFE_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerGlobalActiveSafes {
    GlobalActiveSafe_aggregate { aggregate { count } }
  }
`;

const SPEND_BUCKETS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerSpendBuckets($where: SpendBucketMetric_bool_exp!) {
    SpendBucketMetric(where: $where, order_by: { sortOrder: asc }) { bucket sortOrder spendCount spendUsd }
  }
`;

const HOURLY_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerHourly($where: HourlySpendMetric_bool_exp!) {
    HourlySpendMetric(where: $where, order_by: { hour: asc }) { hour spendCount spendUsd }
  }
`;

const EVENTS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerEvents($eventWhere: ProtocolEvent_bool_exp!) {
    ProtocolEvent(limit: 50, where: $eventWhere, order_by: { timestamp: desc }) {
      id
      eventType
      chainId
      blockNumber
      contractAddress
      actor
      tokenAddress
      amount
      amountUsd
      timestamp
      transactionHash
      metadata
    }
  }
`;

const SPEND_DETAILS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerSpendDetails($ids: [String!]!) {
    Spend(where: { id: { _in: $ids } }) {
      id
      tokens
      amounts
    }
  }
`;

const TOKENS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerTokens($where: Token_bool_exp!) {
    Token(limit: 1000, where: $where) {
      chainId
      address
      name
      symbol
      decimals
      decimalsVerified
      totalSupply
      metadataStatus
      oracleAddress
      oraclePair
      oracleDecimals
      oracleHeartbeat
      oracleDiscovery
      price
      priceUpdatedAt
    }
  }
`;

const TOKEN_ANALYTICS_KEYS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerTokenAnalyticsKeys(
    $spendWhere: SpendTokenValuation_bool_exp!
    $topUpWhere: TopUp_bool_exp!
    $repaymentWhere: Repayment_bool_exp!
    $debtWhere: DebtEvent_bool_exp!
    $balanceWhere: AccountTokenBalance_bool_exp!
  ) {
    spend: SpendTokenValuation(
      distinct_on: [chainId, tokenAddress]
      where: $spendWhere
      order_by: [{ chainId: asc }, { tokenAddress: asc }]
    ) { chainId tokenAddress }
    prices: SpendTokenValuation(
      distinct_on: [chainId, tokenAddress]
      where: $spendWhere
      order_by: [{ chainId: asc }, { tokenAddress: asc }, { timestamp: desc }]
    ) { chainId tokenAddress priceUsdE18 priceStatus }
    topUps: TopUp(
      distinct_on: [chainId, tokenAddress]
      where: $topUpWhere
      order_by: [{ chainId: asc }, { tokenAddress: asc }]
    ) { chainId tokenAddress }
    repayments: Repayment(
      distinct_on: [chainId, tokenAddress]
      where: $repaymentWhere
      order_by: [{ chainId: asc }, { tokenAddress: asc }]
    ) { chainId tokenAddress }
    debt: DebtEvent(
      distinct_on: [chainId, tokenAddress]
      where: $debtWhere
      order_by: [{ chainId: asc }, { tokenAddress: asc }]
    ) { chainId tokenAddress }
    balances: AccountTokenBalance(
      distinct_on: [chainId, tokenAddress]
      where: $balanceWhere
      order_by: [{ chainId: asc }, { tokenAddress: asc }]
    ) { chainId tokenAddress }
  }
`;

const SAFE_ACCOUNTS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerSafeAccounts($where: SafeTokenBalance_bool_exp!) {
    SafeTokenBalance_aggregate(where: { _and: [{ amount: { _gt: "0" } }, $where] }) {
      aggregate { count }
    }
    SafeTokenBalance(
      limit: 5000
      where: { _and: [{ amount: { _gt: "0" } }, $where] }
      order_by: [{ updatedAt: desc }, { safeAddress: asc }, { tokenAddress: asc }]
    ) {
      chainId
      safeAddress
      tokenAddress
      amount
      inflow
      outflow
      updatedAt
      updatedBlock
      transactionHash
    }
  }
`;

// These metric entities are introduced independently of the core cash schema.
// Each query is optional so an indexer deploy can add them without requiring a
// coordinated web deploy (or breaking settled-spend data before it arrives).
const EXTENDED_DAILY_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerExtendedDaily($where: DailyCashMetric_bool_exp!) {
    DailyCashMetric(limit: 6000, where: $where, order_by: { day: desc }) {
      day spendCount spendUsd activeCardCount newCardCount topUpCount
      cashbackUsd onrampUsd offrampUsd borrowedUsd repaidUsd creditSpendUsd debitSpendUsd
    }
  }
`;

const CASHBACK_TOTAL_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerCashbackTotal($where: Cashback_bool_exp!) {
    Cashback_aggregate(where: $where) { aggregate { count sum { amountUsd } } }
  }
`;

const TOP_UP_RECIPIENTS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerTopUpRecipients($where: TopUpRecipientMetric_bool_exp!) {
    TopUpRecipientMetric(
      limit: 10
      where: $where
      order_by: [{ topUpCount: desc }, { recipient: asc }]
    ) { chainId recipient topUpCount }
  }
`;

const CASHBACK_RECEIVERS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerCashbackReceivers($where: CashbackReceiverMetric_bool_exp!) {
    CashbackReceiverMetric(
      limit: 10
      where: $where
      order_by: [{ amountUsd: desc }, { recipient: asc }]
    ) { chainId recipient rewardCount amountUsd }
  }
`;

const REPAYMENT_TOTAL_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerRepaymentTotal($where: Repayment_bool_exp!) {
    Repayment_aggregate(where: $where) { aggregate { sum { amountUsd } } }
  }
`;

const RAMP_TOKEN_METRICS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerRampTokenMetrics($where: RampVolumeSnapshot_bool_exp!) {
    RampVolumeSnapshot_aggregate(where: $where) { aggregate { count } }
    RampVolumeSnapshot(limit: 6000, where: $where, order_by: { dayTimestamp: desc }) {
      chainId label token rampKind dayTimestamp amountRaw rawDecimals amountUsd usdDecimals fxStatus
    }
  }
`;

const FX_RATES_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerFxRates($where: DailyFxRate_bool_exp!, $stateWhere: PriceFeedState_bool_exp!) {
    DailyFxRate(limit: 5000, where: $where, order_by: { day: asc }) {
      chainId day answer decimals updatedAt
    }
    PriceFeedState(where: $stateWhere) {
      chainId pair answer decimals updatedAt
    }
  }
`;

const DEBT_METRICS_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerDebtMetrics($where: DebtPosition_bool_exp!) {
    DebtPosition_aggregate(where: $where) { aggregate { count sum { borrowedUsd repaidUsd outstandingUsd } } }
    DebtPosition(limit: 5000, where: $where, order_by: { outstandingUsd: desc }) {
      chainId user tokenAddress borrowedUsd repaidUsd outstandingUsd usdStatus
    }
  }
`;

// The Cash Safe schema is independently deployed. Every query is optional so
// the existing explorer remains usable until that indexer is reindexed.
const CASH_SAFE_STATE_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerSafeState(
    $tierWhere: SafeTierState_bool_exp!
    $lendWhere: SafeLendState_bool_exp!
    $modeWhere: SafeModeState_bool_exp!
    $limitWhere: SafeSpendingLimitState_bool_exp!
    $withdrawalWhere: PendingWithdrawalState_bool_exp!
    $cashbackWhere: PendingCashbackBalance_bool_exp!
  ) {
    SafeTierState(limit: 5000, where: $tierWhere) { chainId safe tierId updatedAt }
    tier0: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 0 } }] }) { aggregate { count } }
    tier1: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 1 } }] }) { aggregate { count } }
    tier2: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 2 } }] }) { aggregate { count } }
    tier3: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 3 } }] }) { aggregate { count } }
    tier4: SafeTierState_aggregate(where: { _and: [$tierWhere, { tierId: { _eq: 4 } }] }) { aggregate { count } }
    SafeLendState(limit: 5000, where: $lendWhere) { chainId safe status finalizeTime updatedAt }
    SafeModeState(limit: 5000, where: $modeWhere) { chainId safe currentModeId pendingModeId activationTime updatedAt }
    SafeSpendingLimitState(limit: 5000, where: $limitWhere) {
      chainId safe dailyLimit monthlyLimit spentToday spentThisMonth newDailyLimit newMonthlyLimit
      dailyLimitChangeActivationTime monthlyLimitChangeActivationTime updatedAt
    }
    PendingWithdrawalState(limit: 5000, where: $withdrawalWhere) { chainId safe status }
    PendingCashbackBalance(limit: 5000, where: $cashbackWhere) { chainId recipient tokenAddress amountUsd }
  }
`;
const CASH_HISTORY_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerCashHistory($tierWhere: SafeTierChange_bool_exp!, $modeWhere: SafeModeChange_bool_exp!) {
    SafeTierChange(where: $tierWhere, order_by: { timestamp: desc }) {
      previousTierId tierId timestamp
    }
    SafeModeChange(limit: 5000, where: $modeWhere, order_by: { timestamp: desc }) {
      previousModeId modeId timestamp
    }
  }
`;
const CASH_OPERATION_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerCashOperations($resupplyWhere: CollateralResupply_bool_exp!, $failureWhere: LendSupplyFailure_bool_exp!) {
    CollateralResupply_aggregate(where: $resupplyWhere) { aggregate { count } }
    LendSupplyFailure_aggregate(where: $failureWhere) { aggregate { count } }
  }
`;
const CASH_CONFIGURATION_QUERY = /* GraphQL */ `
  query EtherFiCashExplorerConfiguration(
    $tierWhere: TierCashbackPercentage_bool_exp!
    $splitWhere: SafeCashbackSplit_bool_exp!
    $delaysWhere: CashDelaysState_bool_exp!
    $dispatcherWhere: SettlementDispatcherState_bool_exp!
    $gatewayWhere: LendGatewayState_bool_exp!
    $tokenWhere: WithdrawalTokenWhitelist_bool_exp!
    $moduleWhere: WithdrawalModuleWhitelist_bool_exp!
  ) {
    TierCashbackPercentage(limit: 100, where: $tierWhere) { chainId tierId percentage updatedAt }
    SafeCashbackSplit(limit: 5000, where: $splitWhere) { chainId safe splitInBps updatedAt }
    CashDelaysState(limit: 100, where: $delaysWhere) { chainId withdrawalDelay spendingLimitDelay modeDelay updatedAt }
    SettlementDispatcherState(limit: 100, where: $dispatcherWhere) { chainId binSponsorId dispatcher updatedAt }
    LendGatewayState(limit: 100, where: $gatewayWhere) { chainId gateway updatedAt }
    WithdrawalTokenWhitelist(limit: 5000, where: $tokenWhere) { chainId tokenAddress whitelisted updatedAt }
    WithdrawalModuleWhitelist(limit: 5000, where: $moduleWhere) { chainId moduleAddress whitelisted updatedAt }
  }
`;

type Row = Record<string, string | number | boolean | null>;
type DailyTotals = {
  spendCount: number;
  spendUsd: number;
  topUpCount: number;
};
type CoreResponse = {
  ActiveSafe_aggregate: { aggregate: { count: number } | null };
  DailyCashMetric: Row[];
  AccountTokenBalance: Row[];
};
type GlobalActiveSafeResponse = { GlobalActiveSafe_aggregate?: AggregateResponse };
type SpendBucketsResponse = { SpendBucketMetric: Row[] };
type HourlyResponse = { HourlySpendMetric: Row[] };
type EventsResponse = { ProtocolEvent: Row[] };
type SpendDetailsResponse = { Spend: Row[] };
type TokenResponse = { Token: Row[] };
type TokenAnalyticsKeysResponse = {
  spend: Row[];
  prices: Row[];
  topUps: Row[];
  repayments: Row[];
  debt: Row[];
  balances: Row[];
};
type TokenAggregateResponse = {
  aggregate?: {
    count?: number | string;
    sum?: Record<string, number | string | null> | null;
  } | null;
};
type TokenAggregateQueryResponse = Record<string, TokenAggregateResponse>;
type SafeAccountsResponse = { SafeTokenBalance_aggregate?: AggregateResponse; SafeTokenBalance: Row[] };
type AggregateResponse = {
  aggregate?: {
    count?: number | string;
    sum?: {
      amountUsd?: number | string;
      borrowedUsd?: number | string;
      repaidUsd?: number | string;
      outstandingUsd?: number | string;
    } | null;
  } | null;
};
type CashbackTotalResponse = { Cashback_aggregate?: AggregateResponse };
type TopUpRecipientsResponse = { TopUpRecipientMetric: Row[] };
type CashbackReceiversResponse = { CashbackReceiverMetric: Row[] };
type RepaymentTotalResponse = { Repayment_aggregate?: AggregateResponse };
type ExtendedDailyResponse = { DailyCashMetric: Row[] };
type RampTokenMetricsResponse = { RampVolumeSnapshot_aggregate?: AggregateResponse; RampVolumeSnapshot: Row[] };
type FxRatesResponse = { DailyFxRate: Row[]; PriceFeedState: Row[] };
type DebtMetricsResponse = { DebtPosition_aggregate?: AggregateResponse; DebtPosition: Row[] };
type CashSafeStateResponse = {
  SafeTierState: Row[];
  tier0?: AggregateResponse;
  tier1?: AggregateResponse;
  tier2?: AggregateResponse;
  tier3?: AggregateResponse;
  tier4?: AggregateResponse;
  SafeLendState: Row[];
  SafeModeState: Row[];
  SafeSpendingLimitState: Row[];
  PendingWithdrawalState: Row[];
  PendingCashbackBalance: Row[];
};
type CashHistoryResponse = { SafeTierChange: Row[]; SafeModeChange: Row[] };
type CashOperationResponse = {
  CollateralResupply_aggregate?: AggregateResponse;
  LendSupplyFailure_aggregate?: AggregateResponse;
};
type CashConfigurationResponse = {
  TierCashbackPercentage: Row[];
  SafeCashbackSplit: Row[];
  CashDelaysState: Row[];
  SettlementDispatcherState: Row[];
  LendGatewayState: Row[];
  WithdrawalTokenWhitelist: Row[];
  WithdrawalModuleWhitelist: Row[];
};
type TokenRecord = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  decimalsVerified: boolean;
  oracleDecimals: number;
  oracleHeartbeat: number;
  price: string;
  priceUpdatedAt: string;
};

export async function loadExplorerData(filters: { query?: string; chainId?: number } = {}): Promise<ExplorerData> {
  const endpoint =
    process.env.ENVIO_GRAPHQL_URL ?? process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";
  const adminSecret = process.env.ENVIO_HASURA_ADMIN_SECRET;
  const chainWhere = chainWhereFor(filters);

  try {
    const [
      core,
      globalActiveSafes,
      spendBuckets,
      hourlyData,
      eventData,
      tokenData,
      extendedDaily,
      cashbackTotal,
      topUpRecipients,
      cashbackReceivers,
      repaymentTotal,
      rampTokenMetrics,
      fxRates,
      debtMetrics,
      cashSafeState,
      cashHistory,
      cashOperations,
      cashConfiguration,
    ] = await Promise.all([
      graphqlRequired<CoreResponse>(
        endpoint,
        CORE_QUERY,
        {
          activeSafeWhere: chainWhere,
          dailyWhere: chainWhere,
          balanceWhere: chainWhere,
        },
        adminSecret,
      ),
      filters.chainId
        ? Promise.resolve(null)
        : graphqlOptional<GlobalActiveSafeResponse>(endpoint, GLOBAL_ACTIVE_SAFE_QUERY, {}, adminSecret),
      graphqlOptional<SpendBucketsResponse>(endpoint, SPEND_BUCKETS_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<HourlyResponse>(endpoint, HOURLY_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<EventsResponse>(endpoint, EVENTS_QUERY, { eventWhere: eventWhere(filters) }, adminSecret),
      graphqlOptional<TokenResponse>(endpoint, TOKENS_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<ExtendedDailyResponse>(endpoint, EXTENDED_DAILY_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<CashbackTotalResponse>(endpoint, CASHBACK_TOTAL_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<TopUpRecipientsResponse>(endpoint, TOP_UP_RECIPIENTS_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<CashbackReceiversResponse>(
        endpoint,
        CASHBACK_RECEIVERS_QUERY,
        { where: chainWhere },
        adminSecret,
      ),
      graphqlOptional<RepaymentTotalResponse>(endpoint, REPAYMENT_TOTAL_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<RampTokenMetricsResponse>(endpoint, RAMP_TOKEN_METRICS_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<FxRatesResponse>(
        endpoint,
        FX_RATES_QUERY,
        { where: chainWhere, stateWhere: chainWhere },
        adminSecret,
      ),
      graphqlOptional<DebtMetricsResponse>(endpoint, DEBT_METRICS_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<CashSafeStateResponse>(
        endpoint,
        CASH_SAFE_STATE_QUERY,
        {
          tierWhere: chainWhere,
          lendWhere: chainWhere,
          modeWhere: chainWhere,
          limitWhere: chainWhere,
          withdrawalWhere: chainWhere,
          cashbackWhere: chainWhere,
        },
        adminSecret,
      ),
      graphqlOptional<CashHistoryResponse>(
        endpoint,
        CASH_HISTORY_QUERY,
        { tierWhere: chainWhere, modeWhere: chainWhere },
        adminSecret,
      ),
      graphqlOptional<CashOperationResponse>(
        endpoint,
        CASH_OPERATION_QUERY,
        { resupplyWhere: chainWhere, failureWhere: chainWhere },
        adminSecret,
      ),
      graphqlOptional<CashConfigurationResponse>(
        endpoint,
        CASH_CONFIGURATION_QUERY,
        {
          tierWhere: chainWhere,
          splitWhere: chainWhere,
          delaysWhere: chainWhere,
          dispatcherWhere: chainWhere,
          gatewayWhere: chainWhere,
          tokenWhere: chainWhere,
          moduleWhere: chainWhere,
        },
        adminSecret,
      ),
    ]);

    const metricRows = extendedDaily?.DailyCashMetric ?? core.DailyCashMetric ?? [];
    const totals = sumDailyMetrics(metricRows);
    const activeCardCount = integer(
      globalActiveSafes?.GlobalActiveSafe_aggregate?.aggregate?.count ?? core.ActiveSafe_aggregate?.aggregate?.count,
    );
    const cashbackCount = integer(cashbackTotal?.Cashback_aggregate?.aggregate?.count);
    const cashbackUsd = usd(cashbackTotal?.Cashback_aggregate?.aggregate?.sum?.amountUsd);
    const indexedRepaidUsd = usd(repaymentTotal?.Repayment_aggregate?.aggregate?.sum?.amountUsd);
    const debtTotals = debtMetrics?.DebtPosition_aggregate?.aggregate;
    const debtPositions = debtMetrics?.DebtPosition ?? [];
    // Token and unique-borrower breakdowns are only emitted when the bounded
    // metric query contains every position; partial rankings would misstate a
    // protocol-wide breakdown. Aggregate USD totals remain exact either way.
    const debtPositionsComplete = debtMetrics !== null && integer(debtTotals?.count) <= debtPositions.length;
    const debtUsdComplete =
      debtPositionsComplete &&
      debtPositions.length > 0 &&
      debtPositions.every((row) => String(row.usdStatus) === "event_priced_complete");
    const borrowedUsd = sumDailyMetric(metricRows, "borrowedUsd");
    // CashEventEmitter repayments include their canonical event-time USD value.
    // Raw DebtManager positions remain unpriced until a complete price/share model exists.
    const repaidUsd = Math.max(sumDailyMetric(metricRows, "repaidUsd"), indexedRepaidUsd);
    const outstandingDebtUsd = usd(debtTotals?.sum?.outstandingUsd);
    const borrowerCount = debtPositionsComplete
      ? new Set(debtPositions.map((row) => String(row.user).toLowerCase())).size
      : 0;
    const rampSnapshots = rampTokenMetrics?.RampVolumeSnapshot ?? [];
    const rampSnapshotsComplete =
      rampTokenMetrics !== null &&
      integer(rampTokenMetrics?.RampVolumeSnapshot_aggregate?.aggregate?.count) <= rampSnapshots.length;
    const rampAnalytics = rampSnapshotsComplete
      ? buildRampAnalytics(rampSnapshots, fxRates?.DailyFxRate ?? [], fxRates?.PriceFeedState ?? [])
      : emptyRampAnalytics();
    const onrampUsd = rampAnalytics.onrampUsd;
    const offrampUsd = rampAnalytics.offrampUsd;
    const daily = buildDaily(
      metricRows,
      {
        spendCount: totals.spendCount,
        spendUsd: totals.spendUsd,
        activeCards: activeCardCount,
      },
      rampAnalytics.daily,
    );
    const tokens = (tokenData?.Token ?? []).map(tokenRecord);
    const tokenById = new Map(tokens.map((token) => [`${token.chainId}:${token.address}`, token]));
    const spendEventIds = (eventData?.ProtocolEvent ?? [])
      .filter((row) => String(row.eventType).startsWith("spend"))
      .map((row) => String(row.id));
    const spendDetails = spendEventIds.length
      ? await graphqlOptional<SpendDetailsResponse>(endpoint, SPEND_DETAILS_QUERY, { ids: spendEventIds }, adminSecret)
      : null;
    const spendById = new Map((spendDetails?.Spend ?? []).map((row) => [String(row.id), row]));
    const balances = (core.AccountTokenBalance ?? []).map((row) => {
      const tokenAddress = String(row.tokenAddress).toLowerCase();
      const token = tokenById.get(`${Number(row.chainId)}:${tokenAddress}`);
      return {
        chainId: Number(row.chainId),
        account: String(row.accountAddress),
        accountKind: String(row.accountKind),
        token: tokenAddress,
        amount: String(row.amount),
        symbol: token?.symbol ?? "",
        decimals: token?.decimals ?? null,
        amountUsd: token ? indexedTokenAmountUsd(String(row.amount), token) : null,
      };
    });
    const cash = deriveCashSafeData({
      tierStates: cashSafeState?.SafeTierState ?? [],
      lendStates: cashSafeState?.SafeLendState ?? [],
      tierDistribution: cashSafeState
        ? [cashSafeState.tier0, cashSafeState.tier1, cashSafeState.tier2, cashSafeState.tier3, cashSafeState.tier4]
            .map((aggregate, tierId) => ({ tierId, safeCount: integer(aggregate?.aggregate?.count) }))
            .filter((row) => row.safeCount > 0)
        : undefined,
      modeStates: cashSafeState?.SafeModeState ?? [],
      spendingLimitStates: cashSafeState?.SafeSpendingLimitState ?? [],
      pendingWithdrawals: cashSafeState?.PendingWithdrawalState ?? [],
      pendingCashbackBalances: cashSafeState?.PendingCashbackBalance ?? [],
      tierChanges: cashHistory?.SafeTierChange ?? [],
      modeChanges: cashHistory?.SafeModeChange ?? [],
      collateralResupplyCount: integer(cashOperations?.CollateralResupply_aggregate?.aggregate?.count),
      lendSupplyFailureCount: integer(cashOperations?.LendSupplyFailure_aggregate?.aggregate?.count),
      tierCashbackPercentages: cashConfiguration?.TierCashbackPercentage ?? [],
      cashbackSplits: cashConfiguration?.SafeCashbackSplit ?? [],
      delays: cashConfiguration?.CashDelaysState ?? [],
      dispatchers: cashConfiguration?.SettlementDispatcherState ?? [],
      gateways: cashConfiguration?.LendGatewayState ?? [],
      tokenWhitelists: cashConfiguration?.WithdrawalTokenWhitelist ?? [],
      moduleWhitelists: cashConfiguration?.WithdrawalModuleWhitelist ?? [],
    });

    const hasIndexedData = metricRows.length > 0 || activeCardCount > 0 || (eventData?.ProtocolEvent.length ?? 0) > 0;

    return {
      mode: hasIndexedData ? "live" : "empty",
      activeCardCount,
      spendCount: totals.spendCount,
      spendUsd: totals.spendUsd,
      topUpCount: totals.topUpCount,
      cashbackCount,
      cashbackUsd,
      onrampUsd,
      offrampUsd,
      combinedRampUsd: onrampUsd + offrampUsd,
      borrowedUsd,
      repaidUsd,
      outstandingDebtUsd,
      borrowerCount,
      daily,
      spendProfiles: buildSpendProfiles(spendBuckets?.SpendBucketMetric ?? []),
      hourly: buildHourly(hourlyData?.HourlySpendMetric ?? []),
      balances,
      topUpRecipients: (topUpRecipients?.TopUpRecipientMetric ?? []).map((row) => ({
        chainId: Number(row.chainId),
        account: String(row.recipient),
        topUpCount: integer(row.topUpCount),
      })),
      cashbackReceivers: (cashbackReceivers?.CashbackReceiverMetric ?? []).map((row) => ({
        chainId: Number(row.chainId),
        account: String(row.recipient),
        rewardCount: integer(row.rewardCount),
        amountUsd: usd(row.amountUsd),
      })),
      activity: (eventData?.ProtocolEvent ?? []).map((row) => activityRow(row, tokenById, spendById)),
      rampTokens: rampSnapshotsComplete ? buildRampTokens(rampAnalytics.rows, tokenById) : [],
      debtTokens: debtUsdComplete ? buildDebtTokens(debtPositions, tokenById) : [],
      ...cash,
      creditSpendUsd: sumDailyMetric(metricRows, "creditSpendUsd"),
      debitSpendUsd: sumDailyMetric(metricRows, "debitSpendUsd"),
      coverage: buildCoverage({
        cards: globalActiveSafes !== null,
        cashback: cashbackTotal !== null,
        ramps: rampSnapshotsComplete && rampSnapshots.length > 0 && rampAnalytics.fxComplete,
        debt: debtUsdComplete,
      }),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return unavailableData(error instanceof Error ? error.message : "Unknown GraphQL error");
  }
}

export async function loadTokenAnalytics(filters: { chainId?: number } = {}): Promise<TokenAnalyticsRow[]> {
  const endpoint =
    process.env.ENVIO_GRAPHQL_URL ?? process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";
  const adminSecret = process.env.ENVIO_HASURA_ADMIN_SECRET;
  const where = chainWhereFor(filters);

  const [keys, tokenData] = await Promise.all([
    graphqlOptional<TokenAnalyticsKeysResponse>(
      endpoint,
      TOKEN_ANALYTICS_KEYS_QUERY,
      {
        spendWhere: where,
        topUpWhere: where,
        repaymentWhere: where,
        debtWhere: where,
        balanceWhere: where,
      },
      adminSecret,
    ),
    graphqlOptional<TokenResponse>(endpoint, TOKENS_QUERY, { where }, adminSecret),
  ]);
  if (!keys) return [];

  const keyed = {
    spend: tokenKeys(keys.spend),
    topUps: tokenKeys(keys.topUps),
    repayments: tokenKeys(keys.repayments),
    debt: tokenKeys(keys.debt),
    balances: tokenKeys(keys.balances),
  };
  const allKeys = uniqueTokenKeys([
    ...keyed.spend,
    ...keyed.topUps,
    ...keyed.repayments,
    ...keyed.debt,
    ...keyed.balances,
  ]);
  const tokenById = new Map(
    (tokenData?.Token ?? []).map(tokenRecord).map((token) => [`${token.chainId}:${token.address}`, token]),
  );
  const latestSpendPriceById = new Map(
    keys.prices
      .filter((row) => BigInt(String(row.priceUsdE18 ?? "0")) > 0n)
      .map((row) => [
        `${Number(row.chainId)}:${String(row.tokenAddress).toLowerCase()}`,
        fixedPoint(String(row.priceUsdE18), 18),
      ]),
  );

  const [spend, topUps, withdrawals, safeTransfers, balances, supplied, borrowed, debtRepaid, repayments] =
    await Promise.all([
      tokenAggregate(
        endpoint,
        adminSecret,
        keyed.spend,
        (key, alias) =>
          `${alias}: SpendTokenValuation_aggregate(where: ${tokenWhere(key)}) { aggregate { count sum { amountUsd } } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        keyed.topUps,
        (key, alias) => `${alias}: TopUp_aggregate(where: ${tokenWhere(key)}) { aggregate { count sum { amount } } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        allKeys,
        (key, alias) =>
          `${alias}: WithdrawalEvent_aggregate(where: { chainId: { _eq: ${key.chainId} }, status: { _eq: "requested" }, tokens: { _like: "%${key.token}%" } }) { aggregate { count } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        allKeys,
        (key, alias) =>
          `${alias}: SafeTokenBalance_aggregate(where: ${tokenWhere(key)}) { aggregate { count sum { inflow outflow } } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        keyed.balances,
        (key, alias) =>
          `${alias}: AccountTokenBalance_aggregate(where: ${tokenWhere(key)}) { aggregate { count sum { amount inflow outflow } } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        keyed.debt,
        (key, alias) =>
          `${alias}: DebtEvent_aggregate(where: { _and: [${tokenWhere(key)}, { eventType: { _eq: "supplied" } }] }) { aggregate { count sum { amount } } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        keyed.debt,
        (key, alias) =>
          `${alias}: DebtEvent_aggregate(where: { _and: [${tokenWhere(key)}, { eventType: { _in: ["borrowed", "lend_borrowed"] } }] }) { aggregate { count sum { amount amountUsd } } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        keyed.debt,
        (key, alias) =>
          `${alias}: DebtEvent_aggregate(where: { _and: [${tokenWhere(key)}, { eventType: { _eq: "repaid" } }] }) { aggregate { count sum { amount amountUsd } } }`,
      ),
      tokenAggregate(
        endpoint,
        adminSecret,
        keyed.repayments,
        (key, alias) =>
          `${alias}: Repayment_aggregate(where: ${tokenWhere(key)}) { aggregate { count sum { amount amountUsd } } }`,
      ),
    ]);

  return allKeys
    .map((key) => {
      const id = tokenKeyId(key);
      const token = tokenById.get(id);
      const spendAggregate = tokenAggregateValue(spend, keyed.spend, id);
      const topUpAggregate = tokenAggregateValue(topUps, keyed.topUps, id);
      const withdrawalAggregate = tokenAggregateValue(withdrawals, allKeys, id);
      const safeAggregate = tokenAggregateValue(safeTransfers, allKeys, id);
      const balanceAggregate = tokenAggregateValue(balances, keyed.balances, id);
      const suppliedAggregate = tokenAggregateValue(supplied, keyed.debt, id);
      const borrowedAggregate = tokenAggregateValue(borrowed, keyed.debt, id);
      const debtRepaidAggregate = tokenAggregateValue(debtRepaid, keyed.debt, id);
      const repaymentAggregate = tokenAggregateValue(repayments, keyed.repayments, id);
      const reserveBalance = aggregateSum(balanceAggregate, "amount");
      const topUpAmount = aggregateSum(topUpAggregate, "amount");
      const latestSpendPriceUsd = latestSpendPriceById.get(id) ?? null;
      const derivedAmountUsd = (amount: string) =>
        token?.decimalsVerified && latestSpendPriceUsd !== null
          ? fixedPoint(amount, token.decimals) * latestSpendPriceUsd
          : null;
      return {
        chainId: key.chainId,
        token: key.token,
        name: token?.name ?? "",
        symbol: token?.symbol ?? "",
        decimals: token?.decimalsVerified ? token.decimals : null,
        spendCount: aggregateCount(spendAggregate),
        spendUsd: aggregateUsd(spendAggregate, "amountUsd"),
        topUpCount: aggregateCount(topUpAggregate),
        topUpAmount,
        topUpUsd: derivedAmountUsd(topUpAmount),
        withdrawalCount: aggregateCount(withdrawalAggregate),
        safeAccountCount: aggregateCount(safeAggregate),
        safeInflow: aggregateSum(safeAggregate, "inflow"),
        safeOutflow: aggregateSum(safeAggregate, "outflow"),
        destinationCount: aggregateCount(balanceAggregate),
        reserveBalance,
        reserveUsd: token ? (indexedTokenAmountUsd(reserveBalance, token) ?? derivedAmountUsd(reserveBalance)) : null,
        destinationCredits: aggregateSum(balanceAggregate, "inflow"),
        destinationDebits: aggregateSum(balanceAggregate, "outflow"),
        suppliedCount: aggregateCount(suppliedAggregate),
        suppliedAmount: aggregateSum(suppliedAggregate, "amount"),
        borrowedCount: aggregateCount(borrowedAggregate),
        borrowedAmount: aggregateSum(borrowedAggregate, "amount"),
        borrowedUsd: aggregateUsd(borrowedAggregate, "amountUsd"),
        repaidCount: aggregateCount(debtRepaidAggregate) + aggregateCount(repaymentAggregate),
        repaidAmount: addIntegerStrings(
          aggregateSum(debtRepaidAggregate, "amount"),
          aggregateSum(repaymentAggregate, "amount"),
        ),
        repaidUsd: aggregateUsd(debtRepaidAggregate, "amountUsd") + aggregateUsd(repaymentAggregate, "amountUsd"),
      } satisfies TokenAnalyticsRow;
    })
    .filter(
      (row) =>
        row.spendCount ||
        row.topUpCount ||
        row.withdrawalCount ||
        row.safeAccountCount ||
        row.suppliedCount ||
        row.borrowedCount ||
        row.repaidCount,
    )
    .sort(
      (a, b) =>
        b.spendUsd - a.spendUsd ||
        b.topUpCount - a.topUpCount ||
        a.chainId - b.chainId ||
        a.token.localeCompare(b.token),
    );
}

export async function loadSafeAccounts(filters: { query?: string; chainId?: number } = {}): Promise<SafeAccountsData> {
  const endpoint =
    process.env.ENVIO_GRAPHQL_URL ?? process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";
  const adminSecret = process.env.ENVIO_HASURA_ADMIN_SECRET;
  const chainWhere = chainWhereFor(filters);

  try {
    const [safeData, tokenData] = await Promise.all([
      graphqlRequired<SafeAccountsResponse>(endpoint, SAFE_ACCOUNTS_QUERY, { where: chainWhere }, adminSecret),
      graphqlOptional<TokenResponse>(endpoint, TOKENS_QUERY, { where: chainWhere }, adminSecret),
    ]);
    const tokens = (tokenData?.Token ?? []).map(tokenRecord);
    const tokenById = new Map(tokens.map((token) => [`${token.chainId}:${token.address}`, token]));
    const query = filters.query?.trim().toLowerCase();
    const allBalances = safeData.SafeTokenBalance.map((row): SafeAccountBalance => {
      const chainId = Number(row.chainId);
      const tokenAddress = String(row.tokenAddress).toLowerCase();
      const token = tokenById.get(`${chainId}:${tokenAddress}`);
      return {
        chainId,
        safe: String(row.safeAddress).toLowerCase(),
        token: tokenAddress,
        amount: String(row.amount),
        inflow: String(row.inflow),
        outflow: String(row.outflow),
        tokenName: token?.name ?? "",
        symbol: token?.symbol ?? "",
        decimals: token?.decimals ?? null,
        amountUsd: token ? indexedTokenAmountUsd(String(row.amount), token) : null,
        updatedAt: String(row.updatedAt),
        updatedBlock: String(row.updatedBlock),
        transactionHash: String(row.transactionHash),
      };
    });
    const balances = query
      ? allBalances.filter((row) =>
          [row.safe, row.token, row.symbol, row.tokenName, String(row.chainId)].some((value) =>
            value.toLowerCase().includes(query),
          ),
        )
      : allBalances;
    const priced = balances.filter((row) => row.amountUsd !== null);
    const totalCount = integer(safeData.SafeTokenBalance_aggregate?.aggregate?.count);

    return {
      mode: allBalances.length ? "live" : "empty",
      balances,
      accountCount: new Set(balances.map((row) => `${row.chainId}:${row.safe}`)).size,
      positionCount: balances.length,
      pricedPositionCount: priced.length,
      totalUsd: priced.reduce((total, row) => total + (row.amountUsd ?? 0), 0),
      complete: totalCount <= safeData.SafeTokenBalance.length,
    };
  } catch (error) {
    return {
      mode: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown GraphQL error",
      balances: [],
      accountCount: 0,
      positionCount: 0,
      pricedPositionCount: 0,
      totalUsd: 0,
      complete: false,
    };
  }
}

async function graphqlRequired<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> = {},
  adminSecret?: string,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(adminSecret ? { "x-hasura-admin-secret": adminSecret } : {}),
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Envio GraphQL returned HTTP ${response.status}`);
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!payload.data || payload.errors?.length) {
    throw new Error(payload.errors?.map((item) => item.message).join("; ") || "Envio returned no data");
  }
  return payload.data;
}

async function graphqlOptional<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> = {},
  adminSecret?: string,
): Promise<T | null> {
  try {
    return await graphqlRequired<T>(endpoint, query, variables, adminSecret);
  } catch {
    return null;
  }
}

type TokenKey = { chainId: number; token: string };

function tokenKeys(rows: Row[]): TokenKey[] {
  return rows.flatMap((row) => {
    const chainId = Number(row.chainId);
    const token = String(row.tokenAddress).toLowerCase();
    return Number.isInteger(chainId) && /^0x[0-9a-f]{40}$/.test(token) ? [{ chainId, token }] : [];
  });
}

function tokenKeyId(key: TokenKey) {
  return `${key.chainId}:${key.token}`;
}

function uniqueTokenKeys(keys: TokenKey[]): TokenKey[] {
  return [...new Map(keys.map((key) => [tokenKeyId(key), key])).values()].sort(
    (a, b) => a.chainId - b.chainId || a.token.localeCompare(b.token),
  );
}

function tokenWhere(key: TokenKey) {
  return `{ chainId: { _eq: ${key.chainId} }, tokenAddress: { _eq: "${key.token}" } }`;
}

async function tokenAggregate(
  endpoint: string,
  adminSecret: string | undefined,
  keys: TokenKey[],
  field: (key: TokenKey, alias: string) => string,
): Promise<TokenAggregateQueryResponse | null> {
  if (!keys.length) return {};
  const fields = keys.map((key, index) => field(key, `t${index}`)).join("\n");
  return graphqlOptional<TokenAggregateQueryResponse>(
    endpoint,
    `query EtherFiCashExplorerTokenAggregates { ${fields} }`,
    {},
    adminSecret,
  );
}

function tokenAggregateValue(
  response: TokenAggregateQueryResponse | null,
  keys: TokenKey[],
  id: string,
): TokenAggregateResponse | undefined {
  const index = keys.findIndex((key) => tokenKeyId(key) === id);
  return index < 0 ? undefined : response?.[`t${index}`];
}

function aggregateCount(response: TokenAggregateResponse | undefined) {
  return integer(response?.aggregate?.count);
}

function aggregateSum(response: TokenAggregateResponse | undefined, field: string) {
  return String(response?.aggregate?.sum?.[field] ?? "0");
}

function aggregateUsd(response: TokenAggregateResponse | undefined, field: string) {
  return usd(response?.aggregate?.sum?.[field]);
}

function addIntegerStrings(left: string, right: string) {
  return (BigInt(left || "0") + BigInt(right || "0")).toString();
}

function sumDailyMetrics(rows: Row[]) {
  return rows.reduce<DailyTotals>(
    (totals, row) => ({
      spendCount: totals.spendCount + integer(row.spendCount),
      spendUsd: totals.spendUsd + usd(row.spendUsd),
      topUpCount: totals.topUpCount + integer(row.topUpCount),
    }),
    {
      spendCount: 0,
      spendUsd: 0,
      topUpCount: 0,
    },
  );
}

function buildDaily(
  rows: Row[],
  totals: {
    spendCount: number;
    spendUsd: number;
    activeCards: number;
  },
  rampDaily: Map<string, { onrampUsd: number; offrampUsd: number }> = new Map(),
): DailyAnalytics[] {
  const grouped = new Map<
    string,
    Omit<DailyAnalytics, "cumulativeSpendUsd" | "cumulativeTransactions" | "cumulativeCards">
  >();
  for (const row of rows) {
    const day = String(row.day);
    const current = grouped.get(day) ?? {
      day,
      spendUsd: 0,
      transactions: 0,
      activeCards: 0,
      newCards: 0,
      topUps: 0,
      cashbackUsd: 0,
      onrampUsd: 0,
      offrampUsd: 0,
      borrowedUsd: 0,
      repaidUsd: 0,
    };
    current.spendUsd += usd(row.spendUsd);
    current.transactions += integer(row.spendCount);
    current.activeCards += integer(row.activeCardCount);
    current.newCards += integer(row.newCardCount);
    current.topUps += integer(row.topUpCount);
    current.cashbackUsd += usd(row.cashbackUsd);
    current.onrampUsd += usd(row.onrampUsd);
    current.offrampUsd += usd(row.offrampUsd);
    current.borrowedUsd += usd(row.borrowedUsd);
    current.repaidUsd += usd(row.repaidUsd);
    grouped.set(day, current);
  }

  // Ramp snapshots are a latest-state table. Replace the event-time daily
  // metric values with a fresh join to indexed FX history so EURC corrections
  // are reflected without mutating historical metric rows.
  for (const [day, ramp] of rampDaily) {
    const current = grouped.get(day) ?? {
      day,
      spendUsd: 0,
      transactions: 0,
      activeCards: 0,
      newCards: 0,
      topUps: 0,
      cashbackUsd: 0,
      onrampUsd: 0,
      offrampUsd: 0,
      borrowedUsd: 0,
      repaidUsd: 0,
    };
    current.onrampUsd = ramp.onrampUsd;
    current.offrampUsd = ramp.offrampUsd;
    grouped.set(day, current);
  }

  const base = [...grouped.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-730);
  let cumulativeSpendUsd = Math.max(0, totals.spendUsd - sum(base, "spendUsd"));
  let cumulativeTransactions = Math.max(0, totals.spendCount - sum(base, "transactions"));
  let cumulativeCards = Math.max(0, totals.activeCards - sum(base, "newCards"));

  return base.map((row) => {
    cumulativeSpendUsd += row.spendUsd;
    cumulativeTransactions += row.transactions;
    cumulativeCards += row.newCards;
    return {
      ...row,
      cumulativeSpendUsd,
      cumulativeTransactions,
      cumulativeCards,
    };
  });
}

function sum<T extends Record<K, number>, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function buildSpendProfiles(rows: Row[]): SpendProfile[] {
  const grouped = new Map<string, SpendProfile>();
  for (const row of rows) {
    const bucket = String(row.bucket);
    const current = grouped.get(bucket) ?? {
      bucket,
      sortOrder: Number(row.sortOrder),
      spendCount: 0,
      spendUsd: 0,
    };
    current.spendCount += integer(row.spendCount);
    current.spendUsd += usd(row.spendUsd);
    current.sortOrder = Math.min(current.sortOrder, Number(row.sortOrder));
    grouped.set(bucket, current);
  }
  return [...grouped.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function buildHourly(rows: Row[]): HourlyActivity[] {
  const grouped = new Map<number, HourlyActivity>();
  for (const row of rows) {
    const hour = Number(row.hour);
    const current = grouped.get(hour) ?? { hour, spendCount: 0, spendUsd: 0 };
    current.spendCount += integer(row.spendCount);
    current.spendUsd += usd(row.spendUsd);
    grouped.set(hour, current);
  }
  return [...grouped.values()].sort((a, b) => a.hour - b.hour);
}

function sumDailyMetric(rows: Row[], key: string) {
  return rows.reduce((total, row) => total + usd(row[key]), 0);
}

function buildRampTokens(rows: Row[], tokenById: Map<string, TokenRecord>): RampToken[] {
  const grouped = new Map<string, RampToken>();
  for (const row of rows) {
    const token = String(row.token).toLowerCase();
    const label = String(row.label);
    const chainId = Number(row.chainId);
    const key = `${label}:${chainId}:${token}`;
    const current = grouped.get(key) ?? {
      label,
      token,
      tokenSymbol:
        tokenById.get(`${chainId}:${token}`)?.symbol ?? (/^[a-z0-9._-]{2,16}$/i.test(token) ? token.toUpperCase() : ""),
      amountUsd: 0,
    };
    current.amountUsd += Number(row.normalizedAmountUsd ?? 0);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.amountUsd - a.amountUsd);
}

type RampAnalytics = {
  onrampUsd: number;
  offrampUsd: number;
  daily: Map<string, { onrampUsd: number; offrampUsd: number }>;
  rows: Row[];
  fxComplete: boolean;
};

function emptyRampAnalytics(): RampAnalytics {
  return { onrampUsd: 0, offrampUsd: 0, daily: new Map(), rows: [], fxComplete: false };
}

function buildRampAnalytics(snapshots: Row[], dailyRates: Row[], feedStates: Row[]): RampAnalytics {
  const dailyFx = new Map(
    dailyRates.map((row) => [
      `${Number(row.chainId)}:${String(row.day)}`,
      { answer: String(row.answer), decimals: Number(row.decimals ?? 8) },
    ]),
  );
  const latestFx = new Map(
    feedStates.map((row) => [Number(row.chainId), { answer: String(row.answer), decimals: Number(row.decimals ?? 8) }]),
  );
  const daily = new Map<string, { onrampUsd: number; offrampUsd: number }>();
  let onrampUsd = 0;
  let offrampUsd = 0;
  let fxComplete = true;

  const rows = snapshots.map((row) => {
    const chainId = Number(row.chainId);
    const day = new Date(Number(row.dayTimestamp) * 1000).toISOString().slice(0, 10);
    const token = String(row.token);
    const rawAmount = fixedPoint(
      String(row.amountRaw ?? row.amountUsd ?? "0"),
      Number(row.rawDecimals ?? row.usdDecimals ?? 6),
    );
    let normalizedAmountUsd = rawAmount;

    if (isEurRampTokenLabel(token)) {
      const rate = dailyFx.get(`${chainId}:${day}`) ?? latestFx.get(chainId);
      if (rate && BigInt(rate.answer) > 0n) {
        normalizedAmountUsd = rawAmount * fixedPoint(rate.answer, rate.decimals);
      } else if (String(row.fxStatus ?? "").startsWith("chainlink")) {
        normalizedAmountUsd = fixedPoint(String(row.amountUsd ?? "0"), Number(row.usdDecimals ?? 6));
      } else {
        normalizedAmountUsd = 0;
        fxComplete = false;
      }
    }

    const direction = String(row.rampKind);
    const dayValue = daily.get(day) ?? { onrampUsd: 0, offrampUsd: 0 };
    if (direction === "onramp") {
      onrampUsd += normalizedAmountUsd;
      dayValue.onrampUsd += normalizedAmountUsd;
    }
    if (direction === "offramp") {
      offrampUsd += normalizedAmountUsd;
      dayValue.offrampUsd += normalizedAmountUsd;
    }
    daily.set(day, dayValue);
    return { ...row, normalizedAmountUsd };
  });

  return { onrampUsd, offrampUsd, daily, rows, fxComplete };
}

function isEurRampTokenLabel(token: string) {
  return token.toUpperCase().replaceAll(/[^A-Z0-9]/g, "") === "EURC";
}

function buildDebtTokens(rows: Row[], tokenById: Map<string, TokenRecord>): DebtToken[] {
  const grouped = new Map<string, DebtToken>();
  for (const row of rows) {
    const chainId = Number(row.chainId);
    const token = String(row.tokenAddress).toLowerCase();
    const key = `${chainId}:${token}`;
    const current = grouped.get(key) ?? {
      token,
      tokenSymbol: tokenById.get(key)?.symbol ?? "",
      borrowedUsd: 0,
      repaidUsd: 0,
      outstandingUsd: 0,
    };
    current.borrowedUsd += usd(row.borrowedUsd);
    current.repaidUsd += usd(row.repaidUsd);
    current.outstandingUsd += usd(row.outstandingUsd);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.outstandingUsd - a.outstandingUsd);
}

export function deriveCashSafeData(rows: {
  tierStates?: Row[];
  tierDistribution?: Array<{ tierId: number; safeCount: number }>;
  lendStates?: Row[];
  modeStates?: Row[];
  spendingLimitStates?: Row[];
  pendingWithdrawals?: Row[];
  pendingCashbackBalances?: Row[];
  tierChanges?: Row[];
  modeChanges?: Row[];
  collateralResupplyCount?: number;
  lendSupplyFailureCount?: number;
  tierCashbackPercentages?: Row[];
  cashbackSplits?: Row[];
  delays?: Row[];
  dispatchers?: Row[];
  gateways?: Row[];
  tokenWhitelists?: Row[];
  moduleWhitelists?: Row[];
}) {
  const now = Math.floor(Date.now() / 1000);
  const tierDistribution =
    rows.tierDistribution ??
    groupCount(
      (rows.tierStates ?? []).map((row) => ({ ...row, safeCount: 1 })),
      "tierId",
      "safeCount",
    )
      .map(([tierId, safeCount]) => ({ tierId: Number(tierId), safeCount }))
      .sort((a, b) => a.tierId - b.tierId);
  const tierTransitions = groupRows(
    (rows.tierChanges ?? []).map((row) => ({
      ...row,
      day: String(row.timestamp).slice(0, 10),
      fromTierId: row.previousTierId,
      toTierId: row.tierId,
      transitionKind: tierTransitionKind(row.previousTierId, row.tierId),
      count: 1,
    })),
    (row) => `${String(row.day)}:${row.fromTierId ?? "null"}:${row.toTierId}:${String(row.transitionKind)}`,
  )
    .map((row) => ({
      day: String(row.day),
      fromTierId: row.fromTierId === null ? null : Number(row.fromTierId),
      toTierId: Number(row.toTierId),
      count: integer(row.count),
      transitionKind: String(row.transitionKind),
    }))
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) || a.toTierId - b.toTierId || a.transitionKind.localeCompare(b.transitionKind),
    );
  const modeDistribution = groupCount(
    (rows.modeStates ?? []).map((row) => ({ ...row, modeId: effectiveModeId(row, now), safeCount: 1 })),
    "modeId",
    "safeCount",
  )
    .map(([modeId, safeCount]) => ({ modeId: Number(modeId), safeCount }))
    .sort((a, b) => a.modeId - b.modeId);
  const modeChanges = groupRows(
    (rows.modeChanges ?? []).map((row) => ({
      ...row,
      day: String(row.timestamp).slice(0, 10),
      newModeId: row.modeId,
      count: 1,
    })),
    (row) => `${String(row.day)}:${row.previousModeId}:${row.newModeId}`,
  )
    .map((row) => ({
      day: String(row.day),
      previousModeId: Number(row.previousModeId),
      newModeId: Number(row.newModeId),
      count: integer(row.count),
    }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.previousModeId - b.previousModeId || a.newModeId - b.newModeId);
  const lendStates = rows.lendStates ?? [];
  const normalizedLendStates = lendStates.map((row) => effectiveLendStatus(row, now));
  const pendingModes = (rows.modeStates ?? []).filter((row) => hasPendingMode(row, now));
  const pendingLimits = (rows.spendingLimitStates ?? []).filter(
    (row) => Number(row.dailyLimitChangeActivationTime) > now || Number(row.monthlyLimitChangeActivationTime) > now,
  );
  const pendingLendOptOuts = normalizedLendStates.filter((status) => status === "pending_opt_out");
  const configuration = [
    ...(rows.tierCashbackPercentages ?? []).map((row) =>
      configRow(row, "tierCashbackPercentage", String(row.tierId), row.percentage),
    ),
    ...(rows.cashbackSplits ?? []).map((row) => configRow(row, "cashbackSplitInBps", String(row.safe), row.splitInBps)),
    ...(rows.delays ?? []).flatMap((row) => [
      configRow(row, "cashDelays", "withdrawal", row.withdrawalDelay),
      configRow(row, "cashDelays", "spendingLimit", row.spendingLimitDelay),
      configRow(row, "cashDelays", "mode", row.modeDelay),
    ]),
    ...(rows.dispatchers ?? []).map((row) =>
      configRow(row, "settlementDispatcher", String(row.binSponsorId), row.dispatcher),
    ),
    ...(rows.gateways ?? []).map((row) => configRow(row, "lendGateway", "", row.gateway)),
    ...(rows.tokenWhitelists ?? []).map((row) =>
      configRow(row, "withdrawalTokenWhitelist", String(row.tokenAddress), row.whitelisted),
    ),
    ...(rows.moduleWhitelists ?? []).map((row) =>
      configRow(row, "withdrawalModuleWhitelist", String(row.moduleAddress), row.whitelisted),
    ),
  ];

  return {
    tierDistribution,
    tierTransitions,
    modeDistribution,
    modeChanges,
    lendSummary: {
      active: normalizedLendStates.filter((status) => status === "active").length,
      pendingOptOut: pendingLendOptOuts.length,
      optedOut: normalizedLendStates.filter((status) => status === "opted_out").length,
    },
    pendingActions: {
      withdrawals: (rows.pendingWithdrawals ?? []).filter(isPendingWithdrawal).length,
      cashbackUsd: (rows.pendingCashbackBalances ?? []).reduce((total, row) => total + usd(row.amountUsd), 0),
      modeChanges: pendingModes.length,
      spendingLimitChanges: pendingLimits.length,
      lendOptOuts: pendingLendOptOuts.length,
    },
    safeCashStates: buildSafeCashStates(rows, now),
    creditSpendUsd: 0,
    debitSpendUsd: 0,
    collateralResupplyCount: rows.collateralResupplyCount ?? 0,
    lendSupplyFailureCount: rows.lendSupplyFailureCount ?? 0,
    cashConfiguration: configuration.sort(
      (a, b) => a.chainId - b.chainId || a.key.localeCompare(b.key) || a.subkey.localeCompare(b.subkey),
    ),
  };
}

function groupCount(rows: Row[], id: string, count: string): Array<[string, number]> {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[id]);
    grouped.set(key, (grouped.get(key) ?? 0) + integer(row[count]));
  }
  return [...grouped.entries()];
}

function buildSafeCashStates(
  rows: Parameters<typeof deriveCashSafeData>[0],
  now: number,
): ExplorerData["safeCashStates"] {
  const states = new Map<string, Record<string, Row>>();
  const add = (name: string, row: Row) => {
    const key = `${row.chainId}:${String(row.safe).toLowerCase()}`;
    const state = states.get(key) ?? {};
    state[name] = row;
    states.set(key, state);
  };
  for (const row of rows.tierStates ?? []) add("tier", row);
  for (const row of rows.lendStates ?? []) add("lend", row);
  for (const row of rows.modeStates ?? []) add("mode", row);
  for (const row of rows.spendingLimitStates ?? []) add("limit", row);
  for (const row of rows.pendingWithdrawals ?? []) if (isPendingWithdrawal(row)) add("withdrawal", row);
  return [...states.values()]
    .map((state) => {
      const base = state.tier ?? state.lend ?? state.mode ?? state.limit ?? state.withdrawal!;
      const mode = state.mode;
      const limit = state.limit;
      const pendingMode = mode && hasPendingMode(mode, now);
      return {
        chainId: Number(base.chainId),
        safe: String(base.safe),
        tierId: nullableNumber(state.tier?.tierId),
        currentModeId: mode ? effectiveModeId(mode, now) : null,
        pendingModeId: pendingMode ? nullableNumber(mode?.pendingModeId) : null,
        modeActivationTime: String(mode?.activationTime ?? ""),
        lendStatus: state.lend ? effectiveLendStatus(state.lend, now) : "",
        lendFinalizeTime: String(state.lend?.finalizeTime ?? ""),
        dailyLimitUsd: nullableUsd(limit?.dailyLimit),
        monthlyLimitUsd: nullableUsd(limit?.monthlyLimit),
        spentTodayUsd: nullableUsd(limit?.spentToday),
        spentThisMonthUsd: nullableUsd(limit?.spentThisMonth),
        pendingWithdrawal: Boolean(state.withdrawal),
      };
    })
    .sort((a, b) => a.chainId - b.chainId || a.safe.localeCompare(b.safe));
}

function effectiveModeId(row: Row, now: number): number {
  const currentModeId = Number(row.currentModeId);
  const pendingModeId = Number(row.pendingModeId);
  const activationTime = Number(row.activationTime);
  return Number.isFinite(pendingModeId) && pendingModeId !== currentModeId && activationTime <= now
    ? pendingModeId
    : currentModeId;
}

function hasPendingMode(row: Row, now: number): boolean {
  return Number(row.pendingModeId) !== Number(row.currentModeId) && Number(row.activationTime) > now;
}

function effectiveLendStatus(row: Row, now: number): "active" | "pending_opt_out" | "opted_out" | "unknown" {
  const status = String(row.status).toLowerCase();
  if (status === "opted_in" || status === "active") return "active";
  if (status === "opt_out_executed" || status === "opted_out") return "opted_out";
  if (status === "opt_out_requested" || status === "pending_opt_out") {
    return Number(row.finalizeTime) > now ? "pending_opt_out" : "opted_out";
  }
  return "unknown";
}

function tierTransitionKind(previousTierId: unknown, tierId: unknown): string {
  if (previousTierId === null || previousTierId === undefined) return "assigned";
  const previous = Number(previousTierId);
  const next = Number(tierId);
  if (previous === 4 || next === 4) return "segment_change";
  if (next > previous) return "upgrade";
  if (next < previous) return "downgrade";
  return "unchanged";
}

function configRow(row: Row, key: string, subkey: string, value: unknown) {
  return { chainId: Number(row.chainId), key, subkey, value: String(value), updatedAt: String(row.updatedAt) };
}

function isPendingWithdrawal(row: Row) {
  return ["pending", "requested"].includes(String(row.status).toLowerCase());
}

function groupRows(rows: Row[], keyFor: (row: Row) => string): Row[] {
  const grouped = new Map<string, Row>();
  for (const row of rows) {
    const key = keyFor(row);
    const current = grouped.get(key);
    grouped.set(key, current ? { ...current, count: integer(current.count) + integer(row.count) } : row);
  }
  return [...grouped.values()];
}

function sumFields<T extends string>(rows: Row[], keys: T[], usdKeys: T[] = []): Record<T, number> {
  const totals = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const row of rows)
    for (const key of keys) totals[key] += usdKeys.includes(key) ? usd(row[key]) : integer(row[key]);
  return totals;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableUsd(value: unknown): number | null {
  return value === null || value === undefined ? null : usd(value);
}

function buildCoverage(available: { cards: boolean; cashback: boolean; ramps: boolean; debt: boolean }): Coverage[] {
  return [
    {
      key: "settled-spend",
      label: "Settled spend",
      status: "live",
      source: "Envio / Spend + DailyCashMetric",
      note: "On-chain settled CashEventEmitter spend only.",
    },
    {
      key: "spend-active-safes",
      label: "Spend-active safes",
      status: available.cards ? "derived" : "pending",
      source: "Envio / GlobalActiveSafe",
      note: available.cards
        ? "Cross-chain distinct safes with at least one settled Spend; not issued cards."
        : "Current runtime falls back to chain-qualified ActiveSafe rows until the global dedupe entity is reindexed.",
    },
    {
      key: "cashback",
      label: "Cashback",
      status: available.cashback ? "live" : "pending",
      source: "Envio / Cashback",
      note: "On-chain cashback emissions; unavailable until the entity is indexed.",
    },
    {
      key: "ramps",
      label: "Onramp and offramp",
      status: available.ramps ? "derived" : "pending",
      source: "Envio / DailyCashMetric + RampVolumeSnapshot",
      note: "Derived from indexed daily and token ramp snapshots when available.",
    },
    {
      key: "debt",
      label: "UserSafe debt",
      status: available.debt ? "derived" : "pending",
      source: "Envio / DebtPosition + DebtInterestIndex",
      note: available.debt
        ? "Complete event-priced borrow, repayment, liquidation and interest state."
        : "Raw debt, liquidation and interest events are indexed; exact historical USD and accrued per-user debt remain pending.",
    },
    {
      key: "usersafe-aum",
      label: "UserSafe USD / ETH balances",
      status: "pending",
      source: "ERC-20 transfers + lending/collateral state",
      note: "Top-ups minus spend is not exact AUM; direct transfers, yield, collateral and debt effects are not reconstructed.",
    },
    {
      key: "merchant-authorizations",
      label: "Merchant and authorization data",
      status: "offchain",
      source: "Payment provider",
      note: "Exact merchant, MCC, country, and pending or declined authorizations are provider-only.",
    },
  ];
}

function tokenRecord(row: Row): TokenRecord {
  return {
    chainId: Number(row.chainId),
    address: String(row.address).toLowerCase(),
    name: String(row.name),
    symbol: String(row.symbol),
    decimals: Number(row.decimals),
    decimalsVerified: Boolean(row.decimalsVerified),
    oracleDecimals: Number(row.oracleDecimals),
    oracleHeartbeat: Number(row.oracleHeartbeat),
    price: String(row.price),
    priceUpdatedAt: String(row.priceUpdatedAt),
  };
}

function activityRow(row: Row, tokenById: Map<string, TokenRecord>, spendById: Map<string, Row>): Activity {
  const chainId = Number(row.chainId);
  const spend = spendById.get(String(row.id));
  const spendTokens = jsonStringArray(spend?.tokens).map((value) => value.toLowerCase());
  const spendAmounts = jsonStringArray(spend?.amounts);
  const indexedTokenAddress = String(row.tokenAddress).toLowerCase();
  const tokenAddress =
    indexedTokenAddress === zeroAddress && spendTokens.length === 1 ? spendTokens[0] : indexedTokenAddress;
  const token = tokenById.get(`${chainId}:${tokenAddress}`);
  const indexedUsd = usd(row.amountUsd);
  const amount = String(row.amount) === "0" && spendAmounts.length === 1 ? spendAmounts[0] : String(row.amount);
  const pricedUsd = token ? (indexedTokenAmountUsd(amount, token) ?? 0) : 0;
  const metadata = parseMetadata(row.metadata);
  return {
    id: String(row.id),
    type: String(row.eventType),
    chainId,
    blockNumber: String(row.blockNumber),
    contractAddress: String(row.contractAddress),
    actor: String(row.actor),
    token: tokenAddress,
    amount,
    amountUsd: indexedUsd || pricedUsd,
    tokenName: token?.name ?? "",
    tokenSymbol: token?.symbol ?? "",
    tokenDecimals: token?.decimals ?? null,
    tokenCount: Number(metadata.tokenCount ?? spendTokens.length),
    timestamp: String(row.timestamp),
    transactionHash: String(row.transactionHash),
  };
}

function jsonStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function indexedTokenAmountUsd(amount: string, token: TokenRecord): number | null {
  const price = indexedTokenPrice(token);
  return price === null ? null : fixedPoint(amount, token.decimals) * price;
}

function indexedTokenPrice(token: TokenRecord): number | null {
  const answer = BigInt(token.price || "0");
  const updatedAt = BigInt(token.priceUpdatedAt || "0");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const maximumAge = BigInt(Math.max(token.oracleHeartbeat > 0 ? token.oracleHeartbeat * 2 : 86_400, 300));
  if (answer <= 0n || updatedAt <= 0n || updatedAt > now + 60n || now - updatedAt > maximumAge) {
    return null;
  }
  return fixedPoint(answer, token.oracleDecimals);
}

function unavailableData(errorMessage: string): ExplorerData {
  return {
    mode: "error",
    errorMessage,
    activeCardCount: 0,
    spendCount: 0,
    spendUsd: 0,
    topUpCount: 0,
    cashbackCount: 0,
    cashbackUsd: 0,
    onrampUsd: 0,
    offrampUsd: 0,
    combinedRampUsd: 0,
    borrowedUsd: 0,
    repaidUsd: 0,
    outstandingDebtUsd: 0,
    borrowerCount: 0,
    daily: [],
    spendProfiles: [],
    hourly: [],
    balances: [],
    topUpRecipients: [],
    cashbackReceivers: [],
    activity: [],
    rampTokens: [],
    debtTokens: [],
    ...deriveCashSafeData({}),
    coverage: buildCoverage({ cards: false, cashback: false, ramps: false, debt: false }),
    updatedAt: new Date().toISOString(),
  };
}

function integer(value: unknown) {
  return fixedPoint(String(value ?? "0"), 0);
}

function usd(value: unknown) {
  return fixedPoint(String(value ?? "0"), 6);
}

function chainWhereFor(filters: { chainId?: number }) {
  return filters.chainId ? { chainId: { _eq: filters.chainId } } : {};
}

function eventWhere(filters: { query?: string; chainId?: number }) {
  const where: Record<string, unknown> = chainWhereFor(filters);
  const query = filters.query?.trim();
  if (query) {
    const pattern = `%${query}%`;
    where._or = ["transactionHash", "actor", "contractAddress", "tokenAddress", "eventType"].map((field) => ({
      [field]: { _ilike: pattern },
    }));
  }
  return where;
}
