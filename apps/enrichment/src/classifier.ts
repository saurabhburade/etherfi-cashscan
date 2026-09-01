import { canonicalEventId, normalizeAddress } from "./ids.js";
import type { DebtAuditDto, RepaymentDto, ScannerEvent, SourceEvent, SpendDto, TopUpDto } from "./types.js";

const amount = (value: string | null | undefined) => (value == null ? null : BigInt(value));
const base = (
  source: SourceEvent,
  eventType: string,
): Omit<ScannerEvent, "accountAddress" | "tokenAddress" | "amount" | "amountUsd" | "metadata"> => ({
  id: canonicalEventId(source.chainId, source.transactionHash, source.logIndex),
  transactionHash: source.transactionHash.toLowerCase(),
  blockHash: source.blockHash ?? null,
  sourceProvenance: source.sourceProvenance ?? "indexer_graphql",
  chainId: source.chainId,
  timestamp: source.timestamp,
  blockNumber: source.blockNumber,
  logIndex: source.logIndex,
  eventType,
  accountingRole: "canonical",
  accountingDirection: null,
  accountingKind: eventType,
  usdDecimals: 6,
  usdStatus: "unpriced",
});

export function classifySpend(source: SpendDto): ScannerEvent {
  const value = amount(source.totalUsd);
  return {
    ...base(source, "spend"),
    accountAddress: normalizeAddress(source.safe),
    tokenAddress: null,
    amount: null,
    amountUsd: value,
    usdStatus: value == null ? "unpriced" : "priced",
    accountingDirection: source.mode === 0 ? "credit" : "debit",
    accountingKind: "card_spend",
    metadata: {
      txId: source.txId,
      mode: source.mode,
      tokenCount: source.tokens.length,
      accountingDirection: source.mode === 0 ? "credit" : "debit",
      dataAvailability: source.dataAvailability,
    },
  };
}
export function classifyTopUp(source: TopUpDto): ScannerEvent {
  return {
    ...base(source, "topup"),
    accountAddress: normalizeAddress(source.tradingSafe || source.user),
    tokenAddress: normalizeAddress(source.tokenAddress),
    amount: BigInt(source.amount),
    amountUsd: null,
    accountingDirection: "credit",
    accountingKind: "topup",
    metadata: { sourceChainId: source.sourceChainId, txId: source.txId, status: source.status },
  };
}
export function classifyRepayment(source: RepaymentDto): ScannerEvent {
  const value = amount(source.amountUsd);
  return {
    ...base(source, source.repaymentType),
    accountAddress: normalizeAddress(source.safe),
    tokenAddress: normalizeAddress(source.tokenAddress),
    amount: BigInt(source.amount),
    amountUsd: value,
    usdStatus: value == null ? "unpriced" : "priced",
    accountingDirection: "debit",
    accountingKind: source.repaymentType,
    metadata: {},
  };
}
export function classifyDebtAudit(source: DebtAuditDto): ScannerEvent {
  const value = amount(source.amountUsd);
  const canonicalId = canonicalEventId(source.chainId, source.transactionHash, source.logIndex);
  const cashLend = source.eventType === "lend_borrowed" || source.eventType === "repay_lend_token_amount";
  return {
    ...base(source, source.eventType),
    accountAddress: normalizeAddress(source.user),
    tokenAddress: normalizeAddress(source.tokenAddress),
    amount: BigInt(source.amount),
    amountUsd: value,
    usdStatus: value == null ? "unpriced" : "priced",
    accountingRole: cashLend ? "canonical" : "audit",
    accountingDirection: cashLend ? "debit" : null,
    accountingKind: source.eventType,
    metadata: {
      canonicalEventId: canonicalId,
      category: cashLend ? "cash_event_emitter_product" : "debt_manager_audit",
      payer: normalizeAddress(source.payer),
      sourceUsdStatus: source.usdStatus,
    },
  };
}

/** Duplicates are explicit source links only; audit is evidence, not a duplicate. */
export function markDuplicates(events: ScannerEvent[]): ScannerEvent[] {
  return events.map((event) => (event.metadata.duplicateOf ? { ...event, accountingRole: "duplicate" } : event));
}
