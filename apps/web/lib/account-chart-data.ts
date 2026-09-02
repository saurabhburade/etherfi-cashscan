import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import type { AccountAnalyticsDetail } from "./account-analytics";

export type AccountChartSlice = {
  label: string;
  value: number;
  color: string;
};

export type AccountDailyChartPoint = {
  date: Date;
  day: string;
  depositedUsd: number;
  spentUsd: number;
  withdrawnUsd: number;
  cashbackUsd: number;
  borrowedUsd: number;
  repaidUsd: number;
  cumulativeSpendUsd: number;
  cumulativeCashbackUsd: number;
  hasUnpricedSpend: boolean;
  hasUnpricedCashback: boolean;
};

const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
];

export function accountPortfolioSlices(detail: AccountAnalyticsDetail): AccountChartSlice[] {
  const ranked = detail.tokens
    .filter((row) => row.currentBalanceUsd !== null && row.currentBalanceUsd > 0)
    .sort((a, b) => (b.currentBalanceUsd ?? 0) - (a.currentBalanceUsd ?? 0));
  const visible = ranked.slice(0, 6).map((row, index) => ({
    label: tokenLabel(row),
    value: row.currentBalanceUsd ?? 0,
    color: colors[index],
  }));
  const other = ranked.slice(6).reduce((sum, row) => sum + (row.currentBalanceUsd ?? 0), 0);
  return other > 0 ? [...visible, { label: "Other", value: other, color: colors[6] }] : visible;
}

export function accountTokenMetricSlices(
  detail: AccountAnalyticsDetail,
  key: "safeInflowUsd" | "depositedUsd" | "spentUsd" | "withdrawnUsd" | "cashbackUsd",
): AccountChartSlice[] {
  const ranked = detail.tokens
    .filter((row) => row[key] !== null && (row[key] ?? 0) > 0)
    .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
  const visible = ranked.slice(0, 6).map((row, index) => ({
    label: tokenLabel(row),
    value: row[key] ?? 0,
    color: colors[index],
  }));
  const other = ranked.slice(6).reduce((sum, row) => sum + (row[key] ?? 0), 0);
  return other > 0 ? [...visible, { label: "Other", value: other, color: colors[6] }] : visible;
}

export function accountFundingSlices(detail: AccountAnalyticsDetail): AccountChartSlice[] {
  const account = detail.account;
  if (!account) return [];
  return positiveSlices([
    ["Credit", account.creditSpendUsd, colors[0]],
    ["Debit", account.debitSpendUsd, colors[1]],
  ]);
}

/** These mutually exclusive enum buckets partition generated cashback only. */
export function accountCashbackTypeSlices(detail: AccountAnalyticsDetail): AccountChartSlice[] {
  const account = detail.account;
  if (!account) return [];
  return positiveSlices([
    ["Regular", account.lifetimeCashbackRegularUsd, colors[0]],
    ["Spender", account.lifetimeCashbackSpenderUsd, colors[1]],
    ["Promotion", account.lifetimeCashbackPromotionUsd, colors[2]],
    ["Referral", account.lifetimeCashbackReferralUsd, colors[3]],
    ["Other / unknown", account.lifetimeCashbackOtherUsd, colors[4]],
  ]);
}

export function accountDailyChartPoints(detail: AccountAnalyticsDetail): AccountDailyChartPoint[] {
  let cumulativeSpendUsd = 0;
  let cumulativeCashbackUsd = 0;
  return detail.days.map((row) => {
    const depositedUsd = row.depositedUsd ?? 0;
    const spentUsd = row.spentUsd ?? 0;
    const withdrawnUsd = row.withdrawnUsd ?? 0;
    const cashbackUsd = row.cashbackUsd ?? 0;
    const borrowedUsd = row.borrowedUsd ?? 0;
    const repaidUsd = row.repaidUsd ?? 0;
    cumulativeSpendUsd += spentUsd;
    cumulativeCashbackUsd += cashbackUsd;
    return {
      date: new Date(`${row.day}T00:00:00Z`),
      day: row.day,
      depositedUsd,
      spentUsd,
      withdrawnUsd,
      cashbackUsd,
      borrowedUsd,
      repaidUsd,
      cumulativeSpendUsd,
      cumulativeCashbackUsd,
      hasUnpricedSpend: row.spentUsd === null,
      hasUnpricedCashback: row.cashbackUsd === null,
    };
  });
}

function positiveSlices(rows: Array<[string, number | null, string]>): AccountChartSlice[] {
  return rows
    .filter((row): row is [string, number, string] => row[1] !== null && row[1] > 0)
    .map(([label, value, color]) => ({ label, value, color }));
}

function tokenLabel(row: AccountAnalyticsDetail["tokens"][number]) {
  const chainName = INDEXED_CHAIN_BY_ID.get(row.chainId)?.name ?? `Chain ${row.chainId}`;
  return `${row.token.symbol || "Token"} · ${chainName}`;
}
