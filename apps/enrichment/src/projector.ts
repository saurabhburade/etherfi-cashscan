import { classifyDebtAudit, classifyRepayment, classifySpend, classifyTopUp, markDuplicates } from "./classifier.js";
import { canonicalEventId, normalizeAddress } from "./ids.js";
import { normalizeEventImpliedPrice, type PriceObservation } from "./pricing.js";
import type { Projection, ScannerEvent, ScannerEventTokenLeg, SourcePage } from "./types.js";

const ZERO_ADDRESS = /^0x0{40}$/i;
const nullableAddress = (address: string) => (ZERO_ADDRESS.test(address) ? null : normalizeAddress(address));

function genericEvent(row: SourcePage["protocolEvents"][number]): ScannerEvent {
  const amountUsd = row.amountUsd == null || row.amountUsd === "0" ? null : BigInt(row.amountUsd);
  const isTopUp = row.eventType.startsWith("topup_");
  const isRepay =
    row.eventType === "repay" || row.eventType === "repay_debt_manager" || row.eventType === "repay_lend_token_amount";
  const isBorrow = row.eventType === "lend_borrowed";
  const isCashbackSettlement = row.eventType === "pending_cashback_cleared";
  const accountingDirection = isTopUp || isCashbackSettlement ? "credit" : isRepay || isBorrow ? "debit" : "neutral";
  const accountingKind = isTopUp
    ? "topup"
    : isCashbackSettlement
      ? "cashback_received"
      : isRepay || isBorrow
        ? row.eventType
        : "protocol_event";
  return {
    id: row.id.toLowerCase(),
    chainId: row.chainId,
    transactionHash: row.transactionHash.toLowerCase(),
    blockHash: row.blockHash ?? null,
    sourceProvenance: row.sourceProvenance ?? "envio_protocol_event",
    eventType: row.eventType,
    accountAddress: nullableAddress(row.actor),
    tokenAddress: nullableAddress(row.tokenAddress),
    amount: BigInt(row.amount),
    amountUsd,
    usdDecimals: 6,
    usdStatus: amountUsd == null ? "unpriced" : "priced",
    accountingRole: "canonical",
    accountingDirection,
    accountingKind,
    metadata: {
      contractAddress: normalizeAddress(row.contractAddress),
      rawMetadata: row.metadata,
      category: "unknown_or_configuration",
    },
    timestamp: row.timestamp,
    blockNumber: row.blockNumber,
    logIndex: row.logIndex,
  };
}

export function projectPage(page: SourcePage): Projection {
  const events: ScannerEvent[] = [
    ...page.protocolEvents.map(genericEvent),
    ...page.spends.map(classifySpend),
    ...page.topUps.map(classifyTopUp),
    ...page.repayments.map(classifyRepayment),
    ...page.debtEvents.map(classifyDebtAudit),
  ];
  const legs: ScannerEventTokenLeg[] = page.spendLegs.map((leg) => ({
    id: `${leg.spendId}:${leg.tokenIndex}`,
    scannerEventId: leg.spendId,
    tokenAddress: normalizeAddress(leg.tokenAddress),
    tokenIndex: leg.tokenIndex,
    direction: "neutral",
    amount: BigInt(leg.amount),
    amountUsd: leg.amountUsd == null ? null : BigInt(leg.amountUsd),
    usdDecimals: leg.usdDecimals,
    usdStatus: leg.amountUsd == null ? "unpriced" : "priced",
    priceUsdE18: leg.priceUsdE18 == null ? null : BigInt(leg.priceUsdE18),
  }));

  for (const row of page.cashback) {
    const safe = normalizeAddress(row.safe);
    const recipient = normalizeAddress(row.recipient);
    events.push({
      id: canonicalEventId(row.chainId, row.transactionHash, row.logIndex),
      chainId: row.chainId,
      transactionHash: row.transactionHash.toLowerCase(),
      blockHash: row.blockHash ?? null,
      sourceProvenance: row.sourceProvenance ?? "indexer_graphql",
      logIndex: row.logIndex,
      blockNumber: row.blockNumber,
      timestamp: row.timestamp,
      eventType: "cashback",
      accountAddress: safe,
      tokenAddress: normalizeAddress(row.tokenAddress),
      amount: BigInt(row.amount),
      amountUsd: row.amountUsd == null ? null : BigInt(row.amountUsd),
      usdDecimals: 6,
      usdStatus: row.amountUsd == null ? "unpriced" : "priced",
      accountingRole: "canonical",
      accountingDirection: row.paid && recipient === safe ? "credit" : "neutral",
      accountingKind: "cashback",
      // Keep this source record self-contained: the normalized ledger reads the
      // numeric enum and the original recipient/paid state from this payload.
      // uint256: retain the exact source value; only 0..3 have named buckets.
      metadata: { recipient, paid: row.paid, cashbackType: row.cashbackType },
    });
  }

  for (const row of page.withdrawals) {
    const id = canonicalEventId(row.chainId, row.transactionHash, row.logIndex);
    events.push({
      id,
      chainId: row.chainId,
      transactionHash: row.transactionHash.toLowerCase(),
      blockHash: row.blockHash ?? null,
      sourceProvenance: row.sourceProvenance ?? "indexer_graphql",
      logIndex: row.logIndex,
      blockNumber: row.blockNumber,
      timestamp: row.timestamp,
      eventType: `withdrawal_${row.status}`,
      accountAddress: normalizeAddress(row.safe),
      tokenAddress: null,
      amount: null,
      amountUsd: null,
      usdDecimals: 6,
      usdStatus: "unpriced",
      accountingRole: "canonical",
      accountingDirection: "debit",
      accountingKind: "withdrawal",
      metadata: { recipient: normalizeAddress(row.recipient), finalizeTimestamp: row.finalizeTimestamp },
    });
    row.tokens.forEach((token, index) => {
      legs.push({
        id: `${id}:${index}`,
        scannerEventId: id,
        tokenAddress: normalizeAddress(token),
        tokenIndex: index,
        direction: "debit",
        amount: BigInt(row.amounts[index] ?? "0"),
        amountUsd: null,
        usdDecimals: 6,
        usdStatus: "unpriced",
        priceUsdE18: null,
      });
    });
  }

  const resolved = new Map<string, ScannerEvent>();
  const sourceContractById = new Map(
    page.protocolEvents.map((event) => [event.id.toLowerCase(), normalizeAddress(event.contractAddress)]),
  );
  for (const event of events) {
    const contractAddress = sourceContractById.get(event.id);
    resolved.set(event.id, contractAddress ? { ...event, metadata: { ...event.metadata, contractAddress } } : event);
  }
  const canonicalEvents = markDuplicates([...resolved.values()]);
  const eventById = new Map(canonicalEvents.map((event) => [event.id, event]));
  const legEventIds = new Set(legs.map((leg) => leg.scannerEventId));
  for (const event of canonicalEvents) {
    if (
      event.accountingRole === "canonical" &&
      event.tokenAddress &&
      event.amount != null &&
      !legEventIds.has(event.id)
    ) {
      legs.push({
        id: `${event.id}:0`,
        scannerEventId: event.id,
        tokenAddress: event.tokenAddress,
        tokenIndex: 0,
        direction: event.accountingDirection ?? "neutral",
        amount: event.amount,
        amountUsd: event.amountUsd,
        usdDecimals: event.usdDecimals,
        usdStatus: event.usdStatus,
        priceUsdE18: null,
      });
    }
  }
  for (const leg of legs) leg.direction = eventById.get(leg.scannerEventId)?.accountingDirection ?? leg.direction;

  const tokenDecimals = new Map(
    page.tokens.map((token) => [`${token.chainId}:${normalizeAddress(token.address)}`, token.decimals]),
  );
  const priceObservations: PriceObservation[] = [];
  for (const leg of legs) {
    const event = eventById.get(leg.scannerEventId);
    if (!event) continue;
    if (leg.priceUsdE18 == null) {
      const decimals = tokenDecimals.get(`${event.chainId}:${leg.tokenAddress}`);
      if (decimals != null && leg.amountUsd != null) {
        leg.priceUsdE18 = normalizeEventImpliedPrice(leg.amount, leg.amountUsd, decimals, leg.usdDecimals);
      }
    }
    if (leg.priceUsdE18 != null) {
      priceObservations.push({
        id: `${leg.id}:event_implied`,
        chainId: event.chainId,
        tokenAddress: leg.tokenAddress,
        source: "event_implied",
        priceUsdE18: leg.priceUsdE18,
        observedAt: event.timestamp,
        blockNumber: event.blockNumber,
        finalized: true,
      });
    }
  }

  const tokenByOracle = new Map(
    page.tokens.flatMap((token) => {
      const oracle = token.oracleAddress;
      return oracle && !ZERO_ADDRESS.test(oracle)
        ? [[`${token.chainId}:${normalizeAddress(oracle)}`, token] as const]
        : [];
    }),
  );
  for (const feed of page.priceFeeds) {
    const token = tokenByOracle.get(`${feed.chainId}:${normalizeAddress(feed.feedAddress)}`);
    if (!token || BigInt(feed.answer) <= 0n) continue;
    priceObservations.push({
      id: `${feed.id}:chainlink`,
      chainId: feed.chainId,
      tokenAddress: normalizeAddress(token.address),
      source: "chainlink",
      priceUsdE18: (BigInt(feed.answer) * 10n ** 18n) / 10n ** BigInt(feed.decimals),
      observedAt: feed.timestamp,
      blockNumber: feed.blockNumber,
      finalized: true,
    });
  }

  return { events: canonicalEvents, legs, tokens: page.tokens, safeBalances: page.safeBalances, priceObservations };
}
