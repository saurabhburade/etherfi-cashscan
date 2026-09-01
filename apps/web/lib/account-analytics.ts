export const accountAnalyticsEnabled = process.env.CASH_EXPLORER_SCHEMA_ENABLED === "true";

export type AccountAnalyticsMetric = {
  id: string;
  chainId: number;
  safeAddress: string;
  tierId: number | null;
  tokenCount: number;
  transactionCount: number;
  lifetimeDepositedUsd: number | null;
  lifetimeSpentUsd: number | null;
  lifetimeWithdrawnUsd: number | null;
  /** Backward-compatible received cashback total. */
  lifetimeCashbackUsd: number | null;
  lifetimeCashbackGeneratedUsd: number | null;
  lifetimeCashbackReceivedUsd: number | null;
  lifetimeCashbackGeneratedForOthersUsd: number | null;
  lifetimeCashbackRegularUsd: number | null;
  lifetimeCashbackSpenderUsd: number | null;
  lifetimeCashbackPromotionUsd: number | null;
  lifetimeCashbackReferralUsd: number | null;
  lifetimeCashbackOtherUsd: number | null;
  creditSpendUsd: number | null;
  debitSpendUsd: number | null;
  borrowedUsd: number | null;
  repaidUsd: number | null;
  eventLedgerOutstandingDebtUsd: number | null;
  debtStatus: string;
  currentBalanceUsd: number | null;
  netWorthUsd: number | null;
  unpricedPositionCount: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
};

export type AccountTokenAnalytics = {
  id: string;
  chainId: number;
  currentBalanceAmount: string;
  currentBalanceUsd: number | null;
  currentBalanceValuationStatus: string;
  safeInflowAmount: string;
  safeOutflowAmount: string;
  safeBalanceAmount: string;
  safeInflowUsd: number | null;
  safeOutflowUsd: number | null;
  currentPriceUsd: number | null;
  balanceUpdatedAt: string | null;
  priceObservedAt: string | null;
  depositedAmount: string;
  depositedUsd: number | null;
  spentAmount: string;
  spentUsd: number | null;
  withdrawnAmount: string;
  withdrawnUsd: number | null;
  cashbackAmount: string;
  cashbackUsd: number | null;
  borrowedUsd: number | null;
  repaidUsd: number | null;
  outstandingDebtUsd: number | null;
  outstandingDebtStatus: string;
  token: { address: string; symbol: string; name: string; decimals: number | null };
};

export type AccountDayAnalytics = {
  day: string;
  chainId?: number;
  tokenId?: string | null;
  depositedUsd: number | null;
  spentUsd: number | null;
  creditSpendUsd: number | null;
  debitSpendUsd: number | null;
  withdrawnUsd: number | null;
  cashbackUsd: number | null;
  borrowedUsd: number | null;
  repaidUsd: number | null;
  closingBalanceUsd: number | null;
  closingBalanceStatus: string;
  transactionCount: number;
  pricingCoverageRatio: number;
};

export type AccountTokenActivity = {
  id: string;
  chainId: number;
  category: string;
  direction: string;
  fundingMode: string | null;
  status: string;
  amountRaw: string;
  amountUsd: number | null;
  valuationStatus: string;
  valuationSource: string | null;
  /** Raw uint256 from the Cashback event; known labels are only 0 through 3. */
  cashbackType: string | null;
  timestamp: string;
  transactionHash: string;
  token: { address: string; symbol: string; name: string; decimals: number | null };
};

export type AccountAnalyticsDetail = {
  account: AccountAnalyticsMetric | null;
  chainIds: number[];
  tokens: AccountTokenAnalytics[];
  days: AccountDayAnalytics[];
  activity: AccountTokenActivity[];
  safeInflowUsd: number | null;
  safeOutflowUsd: number | null;
  balanceUpdatedAt: string | null;
  priceObservedAt: string | null;
};

export type AccountAnalyticsSort = "balance" | "netWorth" | "spend" | "deposits" | "transactions" | "recent";

export type AccountAnalyticsPage = {
  accounts: AccountAnalyticsMetric[];
  hasNextPage: boolean;
};

const ACCOUNT_FIELDS = `id chainId safeAddress tokenCount transactionCount lifetimeDepositedUsd lifetimeSpentUsd lifetimeWithdrawnUsd lifetimeCashbackUsd lifetimeCashbackGeneratedUsd lifetimeCashbackReceivedUsd lifetimeCashbackGeneratedForOthersUsd lifetimeCashbackRegularUsd lifetimeCashbackSpenderUsd lifetimeCashbackPromotionUsd lifetimeCashbackReferralUsd lifetimeCashbackOtherUsd creditSpendUsd debitSpendUsd borrowedUsd repaidUsd eventLedgerOutstandingDebtUsd debtStatus currentBalanceUsd netWorthUsd unpricedPositionCount firstActivityAt lastActivityAt`;
const ACCOUNT_LIST_QUERY = `query AccountList($limit:Int!,$offset:Int!,$where:AccountMetric_bool_exp!,$orderBy:[AccountMetric_order_by!]!){AccountMetric(limit:$limit,offset:$offset,where:$where,order_by:$orderBy){${ACCOUNT_FIELDS}}}`;
const ACCOUNT_TIERS_QUERY = `query AccountTiers($where:SafeTierState_bool_exp!,$limit:Int!){SafeTierState(where:$where,limit:$limit,order_by:{updatedAt:desc}){chainId safe tierId}}`;
const ACCOUNT_DETAIL_QUERY = `query AccountDetail($accountWhere:AccountMetric_bool_exp!,$tokenWhere:AccountTokenMetric_bool_exp!,$dayWhere:AccountDailyMetric_bool_exp!,$eventWhere:AccountTokenEvent_bool_exp!,$priceWhere:TokenPriceCurrent_bool_exp!,$limit:Int!){AccountMetric(where:$accountWhere,limit:10){id chainId safeAddress tokenCount transactionCount lifetimeDepositedUsd lifetimeSpentUsd lifetimeWithdrawnUsd lifetimeCashbackUsd lifetimeCashbackGeneratedUsd lifetimeCashbackReceivedUsd lifetimeCashbackGeneratedForOthersUsd lifetimeCashbackRegularUsd lifetimeCashbackSpenderUsd lifetimeCashbackPromotionUsd lifetimeCashbackReferralUsd lifetimeCashbackOtherUsd creditSpendUsd debitSpendUsd borrowedUsd repaidUsd eventLedgerOutstandingDebtUsd debtStatus currentBalanceUsd netWorthUsd unpricedPositionCount firstActivityAt lastActivityAt} AccountTokenMetric(where:$tokenWhere,limit:300,order_by:[{currentBalanceUsd:desc_nulls_last},{id:asc}]){id chainId currentBalanceAmount currentBalanceUsd currentBalanceValuationStatus safeInflowAmount safeOutflowAmount safeBalanceAmount updatedAt depositedAmount depositedUsd spentAmount spentUsd withdrawnAmount withdrawnUsd cashbackAmount cashbackUsd borrowedUsd repaidUsd outstandingDebtUsd outstandingDebtStatus token{address symbol name decimals}} TokenPriceCurrent(where:$priceWhere,limit:300){tokenId priceUsd priceStatus observedAt expiresAt token{address chainId}} AccountDailyMetric(where:$dayWhere,limit:5000,order_by:{day:desc}){day chainId tokenId depositedUsd spentUsd creditSpendUsd debitSpendUsd withdrawnUsd cashbackUsd borrowedUsd repaidUsd closingBalanceUsd closingBalanceStatus transactionCount pricingCoverageRatio} AccountTokenEvent(where:$eventWhere,limit:$limit,order_by:[{timestamp:desc},{chainId:asc},{blockNumber:desc},{logIndex:desc},{legIndex:desc},{id:asc}]){id chainId category direction fundingMode status amountRaw amountUsd valuationStatus valuationSource cashbackType timestamp transactionHash token{address symbol name decimals}}}`;

const number = (value: unknown): number | null => (value == null ? null : Number(value));
const integer = (value: unknown): number => Number(value ?? 0);
const string = (value: unknown): string => String(value ?? "");
const token = (row: Record<string, unknown>) => {
  const value = (row.token ?? {}) as Record<string, unknown>;
  return {
    address: string(value.address),
    symbol: string(value.symbol),
    name: string(value.name),
    decimals: value.decimals == null ? null : integer(value.decimals),
  };
};

function account(row: Record<string, unknown>): AccountAnalyticsMetric {
  return {
    id: string(row.id),
    chainId: integer(row.chainId),
    safeAddress: string(row.safeAddress),
    tierId: row.tierId == null ? null : integer(row.tierId),
    tokenCount: integer(row.tokenCount),
    transactionCount: integer(row.transactionCount),
    lifetimeDepositedUsd: number(row.lifetimeDepositedUsd),
    lifetimeSpentUsd: number(row.lifetimeSpentUsd),
    lifetimeWithdrawnUsd: number(row.lifetimeWithdrawnUsd),
    lifetimeCashbackUsd: number(row.lifetimeCashbackUsd),
    lifetimeCashbackGeneratedUsd: number(row.lifetimeCashbackGeneratedUsd),
    lifetimeCashbackReceivedUsd: number(row.lifetimeCashbackReceivedUsd),
    lifetimeCashbackGeneratedForOthersUsd: number(row.lifetimeCashbackGeneratedForOthersUsd),
    lifetimeCashbackRegularUsd: number(row.lifetimeCashbackRegularUsd),
    lifetimeCashbackSpenderUsd: number(row.lifetimeCashbackSpenderUsd),
    lifetimeCashbackPromotionUsd: number(row.lifetimeCashbackPromotionUsd),
    lifetimeCashbackReferralUsd: number(row.lifetimeCashbackReferralUsd),
    lifetimeCashbackOtherUsd: number(row.lifetimeCashbackOtherUsd),
    creditSpendUsd: number(row.creditSpendUsd),
    debitSpendUsd: number(row.debitSpendUsd),
    borrowedUsd: number(row.borrowedUsd),
    repaidUsd: number(row.repaidUsd),
    eventLedgerOutstandingDebtUsd: number(row.eventLedgerOutstandingDebtUsd),
    debtStatus: string(row.debtStatus),
    currentBalanceUsd: number(row.currentBalanceUsd),
    netWorthUsd: number(row.netWorthUsd),
    unpricedPositionCount: integer(row.unpricedPositionCount),
    firstActivityAt: row.firstActivityAt == null ? null : string(row.firstActivityAt),
    lastActivityAt: row.lastActivityAt == null ? null : string(row.lastActivityAt),
  };
}

export async function loadAccountAnalyticsList(limit = 100): Promise<AccountAnalyticsMetric[]> {
  const result = await loadAccountAnalyticsPage({ pageSize: limit });
  return result.accounts;
}

export async function loadAccountAnalyticsPage({
  query,
  chainId,
  sort = "balance",
  page = 1,
  pageSize = 10,
}: {
  query?: string;
  chainId?: number;
  sort?: AccountAnalyticsSort;
  page?: number;
  pageSize?: number;
} = {}): Promise<AccountAnalyticsPage> {
  if (!accountAnalyticsEnabled) return { accounts: [], hasNextPage: false };
  const size = Math.min(100, Math.max(1, Math.trunc(pageSize)));
  const currentPage = Math.max(1, Math.trunc(page));
  const filters: Array<Record<string, unknown>> = [];
  const search = query?.trim().toLowerCase();
  if (search) filters.push({ safeAddress: { _ilike: `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` } });
  if (chainId && Number.isInteger(chainId)) filters.push({ chainId: { _eq: chainId } });
  const where = filters.length ? { _and: filters } : {};
  const orderField = {
    balance: "currentBalanceUsd",
    netWorth: "netWorthUsd",
    spend: "lifetimeSpentUsd",
    deposits: "lifetimeDepositedUsd",
    transactions: "transactionCount",
    recent: "lastActivityAt",
  }[sort];
  const data = await graphql<{ AccountMetric: Array<Record<string, unknown>> }>(ACCOUNT_LIST_QUERY, {
    limit: size + 1,
    offset: (currentPage - 1) * size,
    where,
    orderBy: [{ [orderField]: "desc_nulls_last" }, { id: "asc" }],
  });
  const accounts = await attachAccountTiers(data.AccountMetric.slice(0, size).map(account));
  return {
    accounts,
    hasNextPage: data.AccountMetric.length > size,
  };
}

export async function loadAccountAnalyticsDetail(
  chainId: number | null,
  safeAddress: string,
): Promise<AccountAnalyticsDetail> {
  if (!accountAnalyticsEnabled)
    return {
      account: null,
      chainIds: [],
      tokens: [],
      days: [],
      activity: [],
      safeInflowUsd: null,
      safeOutflowUsd: null,
      balanceUpdatedAt: null,
      priceObservedAt: null,
    };
  const safe = safeAddress.toLowerCase();
  const withChain = <T extends Record<string, unknown>>(where: T) =>
    chainId === null ? where : { _and: [where, { chainId: { _eq: chainId } }] };
  const data = await graphql<{
    AccountMetric: Array<Record<string, unknown>>;
    AccountTokenMetric: Array<Record<string, unknown>>;
    TokenPriceCurrent: Array<Record<string, unknown>>;
    AccountDailyMetric: Array<Record<string, unknown>>;
    AccountTokenEvent: Array<Record<string, unknown>>;
  }>(ACCOUNT_DETAIL_QUERY, {
    accountWhere: withChain({ safeAddress: { _eq: safe } }),
    tokenWhere: withChain({ account: { address: { _eq: safe } } }),
    dayWhere: withChain({ account: { address: { _eq: safe } } }),
    eventWhere: withChain({ account: { address: { _eq: safe } } }),
    priceWhere: {
      token: {
        _and: [
          { account_metrics: { account: { address: { _eq: safe } } } },
          ...(chainId === null ? [] : [{ chainId: { _eq: chainId } }]),
        ],
      },
    },
    limit: 50,
  });
  const accounts = await attachAccountTiers(data.AccountMetric.map(account));
  const currentPrices = new Map(
    data.TokenPriceCurrent.map((row) => {
      const fresh = row.expiresAt != null && Date.parse(string(row.expiresAt)) > Date.now();
      return [
        string(row.tokenId),
        {
          price: fresh && string(row.priceStatus) === "priced" ? number(row.priceUsd) : null,
          observedAt: row.observedAt == null ? null : string(row.observedAt),
        },
      ];
    }),
  );
  const tokens = data.AccountTokenMetric.map((row) => {
    const tokenValue = token(row);
    const tokenId = `${integer(row.chainId)}:${tokenValue.address.toLowerCase()}`;
    const currentPrice = currentPrices.get(tokenId);
    const safeInflowAmount = string(row.safeInflowAmount);
    const safeOutflowAmount = string(row.safeOutflowAmount);
    return {
      id: string(row.id),
      chainId: integer(row.chainId),
      currentBalanceAmount: string(row.currentBalanceAmount),
      currentBalanceUsd: number(row.currentBalanceUsd),
      currentBalanceValuationStatus: string(row.currentBalanceValuationStatus),
      safeInflowAmount,
      safeOutflowAmount,
      safeBalanceAmount: string(row.safeBalanceAmount),
      safeInflowUsd: valueAtCurrentPrice(safeInflowAmount, tokenValue.decimals, currentPrice?.price ?? null),
      safeOutflowUsd: valueAtCurrentPrice(safeOutflowAmount, tokenValue.decimals, currentPrice?.price ?? null),
      currentPriceUsd: currentPrice?.price ?? null,
      balanceUpdatedAt: row.updatedAt == null ? null : string(row.updatedAt),
      priceObservedAt: currentPrice?.observedAt ?? null,
      depositedAmount: string(row.depositedAmount),
      depositedUsd: number(row.depositedUsd),
      spentAmount: string(row.spentAmount),
      spentUsd: number(row.spentUsd),
      withdrawnAmount: string(row.withdrawnAmount),
      withdrawnUsd: number(row.withdrawnUsd),
      cashbackAmount: string(row.cashbackAmount),
      cashbackUsd: number(row.cashbackUsd),
      borrowedUsd: number(row.borrowedUsd),
      repaidUsd: number(row.repaidUsd),
      outstandingDebtUsd: number(row.outstandingDebtUsd),
      outstandingDebtStatus: string(row.outstandingDebtStatus),
      token: tokenValue,
    };
  });
  return {
    account: aggregateAccountMetrics(accounts),
    chainIds: [...new Set(accounts.map((row) => row.chainId))].sort((a, b) => a - b),
    tokens,
    days: aggregateAccountDays(
      data.AccountDailyMetric.map((row) => ({
        day: string(row.day),
        chainId: integer(row.chainId),
        tokenId: row.tokenId == null ? null : string(row.tokenId),
        depositedUsd: number(row.depositedUsd),
        spentUsd: number(row.spentUsd),
        creditSpendUsd: number(row.creditSpendUsd),
        debitSpendUsd: number(row.debitSpendUsd),
        withdrawnUsd: number(row.withdrawnUsd),
        cashbackUsd: number(row.cashbackUsd),
        borrowedUsd: number(row.borrowedUsd),
        repaidUsd: number(row.repaidUsd),
        closingBalanceUsd: number(row.closingBalanceUsd),
        closingBalanceStatus: string(row.closingBalanceStatus),
        transactionCount: integer(row.transactionCount),
        pricingCoverageRatio: number(row.pricingCoverageRatio) ?? 0,
      })),
    ),
    activity: data.AccountTokenEvent.map((row) => ({
      id: string(row.id),
      chainId: integer(row.chainId),
      category: string(row.category),
      direction: string(row.direction),
      fundingMode: row.fundingMode == null ? null : string(row.fundingMode),
      status: string(row.status),
      amountRaw: string(row.amountRaw),
      amountUsd: number(row.amountUsd),
      valuationStatus: string(row.valuationStatus),
      valuationSource: row.valuationSource == null ? null : string(row.valuationSource),
      cashbackType: row.cashbackType == null ? null : string(row.cashbackType),
      timestamp: string(row.timestamp),
      transactionHash: string(row.transactionHash),
      token: token(row),
    })),
    safeInflowUsd: sumComplete(tokens.map((row) => row.safeInflowUsd)),
    safeOutflowUsd: sumComplete(tokens.map((row) => row.safeOutflowUsd)),
    balanceUpdatedAt: latest(tokens.map((row) => row.balanceUpdatedAt)),
    priceObservedAt: latest(tokens.map((row) => row.priceObservedAt)),
  };
}

export function valueAtCurrentPrice(raw: string, decimals: number | null, priceUsd: number | null) {
  if (raw === "0") return 0;
  if (decimals === null || priceUsd === null) return null;
  return (Number(raw) / 10 ** decimals) * priceUsd;
}

const nullableMetricKeys = [
  "lifetimeDepositedUsd",
  "lifetimeSpentUsd",
  "lifetimeWithdrawnUsd",
  "lifetimeCashbackUsd",
  "lifetimeCashbackGeneratedUsd",
  "lifetimeCashbackReceivedUsd",
  "lifetimeCashbackGeneratedForOthersUsd",
  "lifetimeCashbackRegularUsd",
  "lifetimeCashbackSpenderUsd",
  "lifetimeCashbackPromotionUsd",
  "lifetimeCashbackReferralUsd",
  "lifetimeCashbackOtherUsd",
  "creditSpendUsd",
  "debitSpendUsd",
  "borrowedUsd",
  "repaidUsd",
  "eventLedgerOutstandingDebtUsd",
  "currentBalanceUsd",
  "netWorthUsd",
] as const;

export function aggregateAccountMetrics(rows: AccountAnalyticsMetric[]): AccountAnalyticsMetric | null {
  if (!rows.length) return null;
  const first = rows[0];
  if (!first) return null;
  const result: AccountAnalyticsMetric = {
    ...first,
    id: first.safeAddress.toLowerCase(),
    tierId: rows.find((row) => row.tierId !== null)?.tierId ?? null,
    tokenCount: rows.reduce((sum, row) => sum + row.tokenCount, 0),
    transactionCount: rows.reduce((sum, row) => sum + row.transactionCount, 0),
    unpricedPositionCount: rows.reduce((sum, row) => sum + row.unpricedPositionCount, 0),
    firstActivityAt: earliest(rows.map((row) => row.firstActivityAt)),
    lastActivityAt: latest(rows.map((row) => row.lastActivityAt)),
  };
  for (const key of nullableMetricKeys) result[key] = sumComplete(rows.map((row) => row[key]));
  return result;
}

async function attachAccountTiers(accounts: AccountAnalyticsMetric[]) {
  if (!accounts.length) return accounts;
  const data = await graphql<{ SafeTierState: Array<Record<string, unknown>> }>(ACCOUNT_TIERS_QUERY, {
    where: {
      _or: accounts.map((row) => ({
        chainId: { _eq: row.chainId },
        safe: { _eq: row.safeAddress.toLowerCase() },
      })),
    },
    limit: accounts.length,
  });
  const tiers = new Map(
    data.SafeTierState.map((row) => [`${integer(row.chainId)}:${string(row.safe).toLowerCase()}`, integer(row.tierId)]),
  );
  return accounts.map((row) => ({
    ...row,
    tierId: tiers.get(`${row.chainId}:${row.safeAddress.toLowerCase()}`) ?? null,
  }));
}

export function aggregateAccountDays(rows: AccountDayAnalytics[]): AccountDayAnalytics[] {
  const byChainDay = new Map<string, AccountDayAnalytics[]>();
  for (const row of rows) {
    const key = `${row.chainId ?? "unknown"}:${row.day}`;
    byChainDay.set(key, [...(byChainDay.get(key) ?? []), row]);
  }
  const canonicalRows = [...byChainDay.values()].flatMap((values) => {
    const accountRows = values.filter((row) => row.tokenId == null);
    return accountRows.length ? accountRows : values;
  });
  const grouped = new Map<string, AccountDayAnalytics[]>();
  for (const row of canonicalRows) grouped.set(row.day, [...(grouped.get(row.day) ?? []), row]);
  return [...grouped.entries()]
    .map(([day, values]) => {
      const transactionCount = values.reduce((sum, row) => sum + row.transactionCount, 0);
      const weightedPricing = values.reduce((sum, row) => sum + row.pricingCoverageRatio * row.transactionCount, 0);
      const statuses = new Set(values.map((row) => row.closingBalanceStatus));
      return {
        day,
        depositedUsd: sumComplete(values.map((row) => row.depositedUsd)),
        spentUsd: sumComplete(values.map((row) => row.spentUsd)),
        creditSpendUsd: sumComplete(values.map((row) => row.creditSpendUsd)),
        debitSpendUsd: sumComplete(values.map((row) => row.debitSpendUsd)),
        withdrawnUsd: sumComplete(values.map((row) => row.withdrawnUsd)),
        cashbackUsd: sumComplete(values.map((row) => row.cashbackUsd)),
        borrowedUsd: sumComplete(values.map((row) => row.borrowedUsd)),
        repaidUsd: sumComplete(values.map((row) => row.repaidUsd)),
        closingBalanceUsd: sumComplete(values.map((row) => row.closingBalanceUsd)),
        closingBalanceStatus:
          statuses.size === 1 ? (values[0]?.closingBalanceStatus ?? "not_reconstructed") : "partial",
        transactionCount,
        pricingCoverageRatio: transactionCount ? weightedPricing / transactionCount : 0,
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}

function sumComplete(values: Array<number | null>) {
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function earliest(values: Array<string | null>) {
  return values.filter((value): value is string => value !== null).sort()[0] ?? null;
}

function latest(values: Array<string | null>) {
  return (
    values
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  );
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const endpoint =
    process.env.ENVIO_GRAPHQL_URL ?? process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? "http://localhost:8080/v1/graphql";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.ENVIO_HASURA_ADMIN_SECRET) headers["x-hasura-admin-secret"] = process.env.ENVIO_HASURA_ADMIN_SECRET;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || payload.errors?.length || !payload.data)
    throw new Error(payload.errors?.map((error) => error.message).join("; ") || `GraphQL HTTP ${response.status}`);
  return payload.data;
}
