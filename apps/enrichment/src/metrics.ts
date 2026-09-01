import { accountTokenId, normalizeAddress, tokenId } from "./ids.js";
import type { ScannerEvent, ScannerEventTokenLeg } from "./types.js";

export type AccountTokenMetric = {
  id: string;
  chainId: number;
  accountAddress: string;
  tokenAddress: string;
  creditRaw: bigint;
  creditCount: bigint;
  debitRaw: bigint;
  debitCount: bigint;
  spendCreditUsd: bigint | null;
  spendDebitUsd: bigint | null;
  lendBorrowRaw: bigint;
  lendBorrowUsd: bigint | null;
  lendBorrowCount: bigint;
  repaymentRaw: bigint;
  repaymentUsd: bigint | null;
  repaymentCount: bigint;
  repayDebtManagerRaw: bigint;
  repayDebtManagerUsd: bigint | null;
  repayDebtManagerCount: bigint;
  repayLendTokenAmountRaw: bigint;
  repayLendTokenAmountUsd: bigint | null;
  repayLendTokenAmountCount: bigint;
  topUpRaw: bigint;
  topUpUsd: bigint | null;
  topUpCount: bigint;
  cashbackRaw: bigint;
  cashbackUsd: bigint | null;
  cashbackCount: bigint;
  cashbackGeneratedRaw: bigint;
  cashbackGeneratedUsd: bigint | null;
  cashbackGeneratedCount: bigint;
  cashbackReceivedRaw: bigint;
  cashbackReceivedUsd: bigint | null;
  cashbackReceivedCount: bigint;
  cashbackGeneratedForOthersRaw: bigint;
  cashbackGeneratedForOthersUsd: bigint | null;
  cashbackGeneratedForOthersCount: bigint;
  cashbackRegularRaw: bigint;
  cashbackRegularUsd: bigint | null;
  cashbackRegularCount: bigint;
  cashbackSpenderRaw: bigint;
  cashbackSpenderUsd: bigint | null;
  cashbackSpenderCount: bigint;
  cashbackPromotionRaw: bigint;
  cashbackPromotionUsd: bigint | null;
  cashbackPromotionCount: bigint;
  cashbackReferralRaw: bigint;
  cashbackReferralUsd: bigint | null;
  cashbackReferralCount: bigint;
  cashbackOtherRaw: bigint;
  cashbackOtherUsd: bigint | null;
  cashbackOtherCount: bigint;
  withdrawalRequestedRaw: bigint;
  withdrawalRequestedUsd: bigint | null;
  withdrawalRequestedCount: bigint;
  safeBalanceRaw: bigint | null;
};
export type TokenDailyMetric = {
  id: string;
  chainId: number;
  tokenAddress: string;
  day: string;
  creditRaw: bigint;
  debitRaw: bigint;
  lendBorrowRaw: bigint;
  repaymentRaw: bigint;
  cashbackRaw: bigint;
  topUpRaw: bigint;
  withdrawalRaw: bigint;
};
export type AccountTokenDailyMetric = AccountTokenMetric & { day: string };
const day = (time: string) => time.slice(0, 10);
const empty = (chainId: number, account: string, token: string): AccountTokenMetric => ({
  id: accountTokenId(chainId, account, token),
  chainId,
  accountAddress: normalizeAddress(account),
  tokenAddress: normalizeAddress(token),
  creditRaw: 0n,
  creditCount: 0n,
  debitRaw: 0n,
  debitCount: 0n,
  spendCreditUsd: null,
  spendDebitUsd: null,
  lendBorrowRaw: 0n,
  lendBorrowUsd: null,
  lendBorrowCount: 0n,
  repaymentRaw: 0n,
  repaymentUsd: null,
  repaymentCount: 0n,
  repayDebtManagerRaw: 0n,
  repayDebtManagerUsd: null,
  repayDebtManagerCount: 0n,
  repayLendTokenAmountRaw: 0n,
  repayLendTokenAmountUsd: null,
  repayLendTokenAmountCount: 0n,
  topUpRaw: 0n,
  topUpUsd: null,
  topUpCount: 0n,
  cashbackRaw: 0n,
  cashbackUsd: null,
  cashbackCount: 0n,
  cashbackGeneratedRaw: 0n,
  cashbackGeneratedUsd: null,
  cashbackGeneratedCount: 0n,
  cashbackReceivedRaw: 0n,
  cashbackReceivedUsd: null,
  cashbackReceivedCount: 0n,
  cashbackGeneratedForOthersRaw: 0n,
  cashbackGeneratedForOthersUsd: null,
  cashbackGeneratedForOthersCount: 0n,
  cashbackRegularRaw: 0n,
  cashbackRegularUsd: null,
  cashbackRegularCount: 0n,
  cashbackSpenderRaw: 0n,
  cashbackSpenderUsd: null,
  cashbackSpenderCount: 0n,
  cashbackPromotionRaw: 0n,
  cashbackPromotionUsd: null,
  cashbackPromotionCount: 0n,
  cashbackReferralRaw: 0n,
  cashbackReferralUsd: null,
  cashbackReferralCount: 0n,
  cashbackOtherRaw: 0n,
  cashbackOtherUsd: null,
  cashbackOtherCount: 0n,
  withdrawalRequestedRaw: 0n,
  withdrawalRequestedUsd: null,
  withdrawalRequestedCount: 0n,
  safeBalanceRaw: null,
});
const addUsd = (current: bigint | null, incoming: bigint | null) =>
  incoming == null ? current : (current ?? 0n) + incoming;

/** Only canonical rows are counted. A safe balance is raw balance, not debt or AUM. */
export function deriveAccountTokenMetrics(
  events: ScannerEvent[],
  legs: ScannerEventTokenLeg[],
  safeBalances: Array<{ chainId: number; safeAddress: string; tokenAddress: string; amount: string }>,
): AccountTokenMetric[] {
  const out = new Map<string, AccountTokenMetric>();
  const ensure = (chainId: number, account: string, token: string) => {
    const key = accountTokenId(chainId, account, token);
    let row = out.get(key);
    if (!row) {
      row = empty(chainId, account, token);
      out.set(key, row);
    }
    return row;
  };
  const eventById = new Map(events.map((event) => [event.id, event]));
  for (const leg of legs) {
    const event = eventById.get(leg.scannerEventId);
    if (event?.accountingRole !== "canonical" || !event.accountAddress) continue;
    const row = ensure(event.chainId, event.accountAddress, leg.tokenAddress);
    if (event.eventType === "spend") {
      if ((event.metadata.mode as number) === 0) {
        row.creditRaw += leg.amount;
        row.creditCount += 1n;
        row.spendCreditUsd = addUsd(row.spendCreditUsd, leg.amountUsd);
      } else {
        row.debitRaw += leg.amount;
        row.debitCount += 1n;
        row.spendDebitUsd = addUsd(row.spendDebitUsd, leg.amountUsd);
      }
    } else if (event.eventType === "withdrawal_requested") {
      row.withdrawalRequestedRaw += leg.amount;
      row.withdrawalRequestedCount += 1n;
      row.withdrawalRequestedUsd = addUsd(row.withdrawalRequestedUsd, leg.amountUsd);
    }
  }
  for (const event of events) {
    if (event.accountingRole !== "canonical" || !event.accountAddress || !event.tokenAddress || event.amount == null)
      continue;
    const row = ensure(event.chainId, event.accountAddress, event.tokenAddress);
    if (event.eventType === "topup") {
      row.topUpRaw += event.amount;
      row.topUpCount += 1n;
      row.topUpUsd = addUsd(row.topUpUsd, event.amountUsd);
    } else if (event.eventType === "lend_borrowed") {
      row.lendBorrowRaw += event.amount;
      row.lendBorrowCount += 1n;
      row.lendBorrowUsd = addUsd(row.lendBorrowUsd, event.amountUsd);
    } else if (event.eventType === "repay") {
      row.repaymentRaw += event.amount;
      row.repaymentCount += 1n;
      row.repaymentUsd = addUsd(row.repaymentUsd, event.amountUsd);
    } else if (event.eventType === "repay_debt_manager") {
      row.repayDebtManagerRaw += event.amount;
      row.repayDebtManagerCount += 1n;
      row.repayDebtManagerUsd = addUsd(row.repayDebtManagerUsd, event.amountUsd);
    } else if (event.eventType === "repay_lend_token_amount") {
      row.repayLendTokenAmountRaw += event.amount;
      row.repayLendTokenAmountCount += 1n;
      row.repayLendTokenAmountUsd = addUsd(row.repayLendTokenAmountUsd, event.amountUsd);
    } else if (event.eventType === "cashback" || event.accountingKind === "cashback_received") {
      const recipient = String(event.metadata.recipient ?? event.accountAddress).toLowerCase();
      const paid = event.accountingKind === "cashback_received" || event.metadata.paid === true;
      const settlement = event.accountingKind === "cashback_received";
      const received = settlement || (paid && recipient === event.accountAddress);
      const cashbackType = String(event.metadata.cashbackType ?? "");
      const add = (raw: keyof AccountTokenMetric, usd: keyof AccountTokenMetric, count: keyof AccountTokenMetric) => {
        (row[raw] as bigint) += event.amount!;
        row[usd] = addUsd(row[usd] as bigint | null, event.amountUsd) as never;
        (row[count] as bigint) += 1n;
      };
      if (!settlement) {
        add("cashbackGeneratedRaw", "cashbackGeneratedUsd", "cashbackGeneratedCount");
        if (recipient !== event.accountAddress)
          add("cashbackGeneratedForOthersRaw", "cashbackGeneratedForOthersUsd", "cashbackGeneratedForOthersCount");
        if (cashbackType === "0") add("cashbackRegularRaw", "cashbackRegularUsd", "cashbackRegularCount");
        else if (cashbackType === "1") add("cashbackSpenderRaw", "cashbackSpenderUsd", "cashbackSpenderCount");
        else if (cashbackType === "2") add("cashbackPromotionRaw", "cashbackPromotionUsd", "cashbackPromotionCount");
        else if (cashbackType === "3") add("cashbackReferralRaw", "cashbackReferralUsd", "cashbackReferralCount");
        else add("cashbackOtherRaw", "cashbackOtherUsd", "cashbackOtherCount");
      }
      if (received) {
        // Legacy cashback remains the received view.
        add("cashbackRaw", "cashbackUsd", "cashbackCount");
        add("cashbackReceivedRaw", "cashbackReceivedUsd", "cashbackReceivedCount");
      }
    } else if (event.eventType === "withdrawal_requested") {
      row.withdrawalRequestedRaw += event.amount;
      row.withdrawalRequestedCount += 1n;
      row.withdrawalRequestedUsd = addUsd(row.withdrawalRequestedUsd, event.amountUsd);
    }
  }
  for (const balance of safeBalances)
    ensure(balance.chainId, balance.safeAddress, balance.tokenAddress).safeBalanceRaw = BigInt(balance.amount);
  return [...out.values()];
}

export function deriveTokenDailyMetrics(events: ScannerEvent[], legs: ScannerEventTokenLeg[]): TokenDailyMetric[] {
  const out = new Map<string, TokenDailyMetric>();
  const ensure = (chainId: number, token: string, timestamp: string) => {
    const id = `${tokenId(chainId, token)}:${day(timestamp)}`;
    let row = out.get(id);
    if (!row) {
      row = {
        id,
        chainId,
        tokenAddress: normalizeAddress(token),
        day: day(timestamp),
        creditRaw: 0n,
        debitRaw: 0n,
        lendBorrowRaw: 0n,
        repaymentRaw: 0n,
        cashbackRaw: 0n,
        topUpRaw: 0n,
        withdrawalRaw: 0n,
      };
      out.set(id, row);
    }
    return row;
  };
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const leg of legs) {
    const e = byId.get(leg.scannerEventId);
    if (e?.accountingRole !== "canonical" || e.eventType !== "spend") continue;
    const r = ensure(e.chainId, leg.tokenAddress, e.timestamp);
    if (e.metadata.mode === 0) r.creditRaw += leg.amount;
    else r.debitRaw += leg.amount;
  }
  for (const e of events) {
    if (e.accountingRole !== "canonical" || !e.tokenAddress || e.amount == null) continue;
    const r = ensure(e.chainId, e.tokenAddress, e.timestamp);
    if (e.eventType === "topup") r.topUpRaw += e.amount;
    else if (e.eventType === "lend_borrowed") r.lendBorrowRaw += e.amount;
    else if (e.eventType.startsWith("repay")) r.repaymentRaw += e.amount;
    else if (e.eventType === "cashback") r.cashbackRaw += e.amount;
    else if (e.eventType === "withdrawal_requested") r.withdrawalRaw += e.amount;
  }
  return [...out.values()];
}

/** Daily rows retain the same accounting separation as cumulative rows. Safe
 * balances are point-in-time state and intentionally are not treated as flow. */
export function deriveAccountTokenDailyMetrics(
  events: ScannerEvent[],
  legs: ScannerEventTokenLeg[],
): AccountTokenDailyMetric[] {
  const byDay = new Map<string, ScannerEvent[]>();
  for (const event of events) {
    const key = day(event.timestamp);
    const group = byDay.get(key) ?? [];
    group.push(event);
    byDay.set(key, group);
  }
  const output: AccountTokenDailyMetric[] = [];
  for (const [metricDay, dayEvents] of byDay) {
    const ids = new Set(dayEvents.map((event) => event.id));
    const dayLegs = legs.filter((leg) => ids.has(leg.scannerEventId));
    for (const row of deriveAccountTokenMetrics(dayEvents, dayLegs, []))
      output.push({ ...row, id: `${row.id}:${metricDay}`, day: metricDay, safeBalanceRaw: null });
  }
  return output;
}
