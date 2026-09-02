import { indexer } from "envio";
import {
  currentTokenPriceEffect,
  fifteenMinuteBucket,
  lendingStateSnapshotEffect,
  priceProviderAvailableAtBlock,
} from "../envio-enrichment-effects.js";
import { erc20MetadataEffect } from "../erc20-metadata-effect.js";
import {
  accountId,
  amountAtPrice,
  applyBalanceDelta,
  asBigInt,
  balanceChange,
  bytes32Label,
  dailyMetricId,
  dayFromUnixSeconds,
  eventId,
  fifteenMinuteBucketId,
  hourFromUnixSeconds,
  impliedUsdPriceE18,
  isFreshNonFuturePrice,
  isLaterTokenSpend,
  priceDeviationOverHalf,
  rampAmountUsd,
  rampKindFromLabel,
  spendBucket,
  uniqueLowercase,
  ZERO_ADDRESS,
} from "../logic.js";
import {
  canonicalAssetPriceBucketId,
  tokenFromRegistry,
  tokenPriceBucketId,
  verifiedCanonicalPriceAsset,
} from "../token-enrichment.js";
import { decodeSnapshotEffectResult } from "./state-enrichment.js";

// Alias keeps the current Cash handlers visually grouped while preserving the
// generated Envio type checks after codegen.
const cashIndexer = indexer;

type BlockEvent = {
  chainId: number;
  srcAddress: string;
  logIndex: number;
  block: { number: number | bigint; timestamp: number | bigint; hash: string };
  transaction: { hash: string; transactionIndex: number | bigint };
};

type MetricDelta = Partial<{
  spendCount: bigint;
  spendUsd: bigint;
  creditSpendUsd: bigint;
  debitSpendUsd: bigint;
  activeCardCount: bigint;
  newCardCount: bigint;
  topUpCount: bigint;
  cashbackUsd: bigint;
  onrampUsd: bigint;
  offrampUsd: bigint;
  borrowedUsd: bigint;
  repaidUsd: bigint;
}>;

const ts = (event: BlockEvent) => new Date(Number(event.block.timestamp) * 1000);
const lower = (value: string) => value.toLowerCase();
const jsonBigInts = (values: readonly (bigint | number | string)[]) => JSON.stringify(values.map(String));

const tokenMetricDefaults = {
  spendCount: 0n,
  spendAmount: 0n,
  spendUsd: 0n,
  topUpCount: 0n,
  topUpAmount: 0n,
  withdrawalCount: 0n,
  safeAccountCount: 0n,
  safeBalance: 0n,
  safeInflow: 0n,
  safeOutflow: 0n,
  destinationCount: 0n,
  destinationBalance: 0n,
  destinationInflow: 0n,
  destinationOutflow: 0n,
  suppliedCount: 0n,
  suppliedAmount: 0n,
  borrowedCount: 0n,
  borrowedAmount: 0n,
  borrowedUsd: 0n,
  borrowedUsdLatest: 0n,
  borrowedUsdLatestStatus: "unpriced",
  borrowedUsdLatestPriceUsdE18: 0n,
  borrowedUsdLatestPriceAt: new Date(0),
  borrowedUsdLatestPriceChainId: 0,
  borrowedUsdLatestPriceSource: "none",
  repaidCount: 0n,
  repaidAmount: 0n,
  repaidUsd: 0n,
  latestSpendPriceUsdE18: 0n,
  latestSpendPriceStatus: "unavailable",
  latestSpendAt: new Date(0),
  latestSpendBlockNumber: 0n,
  latestSpendLogIndex: 0,
  latestSpendValuationId: "",
};

const tokenAnalyticsDefaults = {
  hasSpend: false,
  hasTopUp: false,
  hasRepayment: false,
  hasDebt: false,
  hasBalance: false,
  latestSpendPriceUsdE18: 0n,
  latestSpendPriceStatus: "unavailable",
  latestSpendAt: new Date(0),
  latestSpendBlockNumber: 0n,
  latestSpendLogIndex: 0,
  latestSpendValuationId: "",
  analyticsUpdatedAt: new Date(0),
};

async function recordToken(context: any, event: BlockEvent, tokenAddress: string) {
  const address = lower(tokenAddress);
  const id = `${event.chainId}:${address}`;
  const existing = await context.Token.get(id);
  if (existing) return existing;
  const registered = tokenFromRegistry(event.chainId, address);
  const metadata =
    registered.metadataStatus === "static_verified"
      ? registered
      : await context.effect(erc20MetadataEffect, { address });
  const token = {
    id,
    chainId: event.chainId,
    address,
    ...registered,
    name: metadata.name,
    symbol: metadata.symbol,
    decimals: metadata.decimals,
    decimalsVerified: metadata.decimalsVerified,
    metadataStatus: metadata.metadataStatus,
    discoveredAt: ts(event),
    discoveredBlock: asBigInt(event.block.number),
    ...tokenAnalyticsDefaults,
  };
  context.Token.set(token);
  return token;
}

async function markTokenAnalytics(
  context: any,
  event: BlockEvent,
  tokenAddress: string,
  update: Record<string, unknown>,
) {
  const token = await recordToken(context, event, tokenAddress);
  context.Token.set({ ...token, ...update, analyticsUpdatedAt: ts(event) });
}

type TokenAnalyticsDelta = Partial<typeof tokenMetricDefaults>;

function validIndexedTokenPrice(price: any) {
  return Boolean(
    price?.priceUsdE18 &&
      price.priceUsdE18 > 0n &&
      [
        "event_priced",
        "oracle_priced",
        "canonical_bucket_priced",
        "cross_chain_event_priced",
        "cross_chain_oracle_priced",
      ].includes(price.priceStatus),
  );
}

async function updateTokenAnalytics(context: any, event: BlockEvent, tokenAddress: string, delta: TokenAnalyticsDelta) {
  const address = lower(tokenAddress);
  const token = await recordToken(context, event, address);
  const id = `${event.chainId}:${address}`;
  const current = (await context.TokenAnalyticsMetric.get(id)) ?? {
    id,
    chainId: event.chainId,
    tokenAddress: address,
    ...tokenMetricDefaults,
    updatedAt: new Date(0),
    updatedBlock: 0n,
    updatedTransactionHash: "",
    updatedLogIndex: 0,
  };
  const latest = delta.latestSpendValuationId
    ? {
        latestSpendPriceUsdE18: delta.latestSpendPriceUsdE18 ?? current.latestSpendPriceUsdE18,
        latestSpendPriceStatus: delta.latestSpendPriceStatus ?? current.latestSpendPriceStatus,
        latestSpendAt: delta.latestSpendAt ?? current.latestSpendAt,
        latestSpendBlockNumber: delta.latestSpendBlockNumber ?? current.latestSpendBlockNumber,
        latestSpendLogIndex: delta.latestSpendLogIndex ?? current.latestSpendLogIndex,
        latestSpendValuationId: delta.latestSpendValuationId,
      }
    : {};
  const borrowedAmount = current.borrowedAmount + (delta.borrowedAmount ?? 0n);
  // TokenPriceCurrent is the single Envio-owned price state. It is populated
  // by event-implied USD observations and exact-block oracle effects. A failed
  // refresh must not replace the last valid price used by this latest-value
  // projection.
  const indexedPrice = await context.TokenPriceCurrent.get(id);
  const selectedPrice = validIndexedTokenPrice(indexedPrice) ? indexedPrice : null;
  const candidateRejected = Boolean(
    selectedPrice &&
      current.borrowedUsdLatestPriceUsdE18 > 0n &&
      priceDeviationOverHalf(selectedPrice.priceUsdE18, current.borrowedUsdLatestPriceUsdE18),
  );
  const acceptedPrice = candidateRejected ? null : selectedPrice;
  const borrowedUsdLatestPriceUsdE18 = acceptedPrice ? acceptedPrice.priceUsdE18 : current.borrowedUsdLatestPriceUsdE18;
  const borrowedUsdLatestPriceAt = acceptedPrice
    ? (acceptedPrice.observedAt ?? ts(event))
    : current.borrowedUsdLatestPriceAt;
  const borrowedUsdLatestPriceChainId = acceptedPrice
    ? (acceptedPrice.referenceChainId ?? event.chainId)
    : current.borrowedUsdLatestPriceChainId;
  const borrowedUsdLatestPriceSource = acceptedPrice ? acceptedPrice.sourceType : current.borrowedUsdLatestPriceSource;
  const hasLatestBorrowPrice = token.decimalsVerified && borrowedUsdLatestPriceUsdE18 > 0n;
  const borrowedUsdLatestStatus = hasLatestBorrowPrice
    ? borrowedUsdLatestPriceChainId === event.chainId
      ? "latest_indexed_price"
      : "latest_cross_chain_price"
    : "unpriced";
  context.TokenAnalyticsMetric.set({
    ...current,
    spendCount: current.spendCount + (delta.spendCount ?? 0n),
    spendAmount: current.spendAmount + (delta.spendAmount ?? 0n),
    spendUsd: current.spendUsd + (delta.spendUsd ?? 0n),
    topUpCount: current.topUpCount + (delta.topUpCount ?? 0n),
    topUpAmount: current.topUpAmount + (delta.topUpAmount ?? 0n),
    withdrawalCount: current.withdrawalCount + (delta.withdrawalCount ?? 0n),
    safeAccountCount: current.safeAccountCount + (delta.safeAccountCount ?? 0n),
    safeBalance: current.safeBalance + (delta.safeBalance ?? 0n),
    safeInflow: current.safeInflow + (delta.safeInflow ?? 0n),
    safeOutflow: current.safeOutflow + (delta.safeOutflow ?? 0n),
    destinationCount: current.destinationCount + (delta.destinationCount ?? 0n),
    destinationBalance: current.destinationBalance + (delta.destinationBalance ?? 0n),
    destinationInflow: current.destinationInflow + (delta.destinationInflow ?? 0n),
    destinationOutflow: current.destinationOutflow + (delta.destinationOutflow ?? 0n),
    suppliedCount: current.suppliedCount + (delta.suppliedCount ?? 0n),
    suppliedAmount: current.suppliedAmount + (delta.suppliedAmount ?? 0n),
    borrowedCount: current.borrowedCount + (delta.borrowedCount ?? 0n),
    borrowedAmount,
    borrowedUsd: current.borrowedUsd + (delta.borrowedUsd ?? 0n),
    borrowedUsdLatest: hasLatestBorrowPrice
      ? amountAtPrice(borrowedAmount, borrowedUsdLatestPriceUsdE18, token.decimals)
      : 0n,
    borrowedUsdLatestStatus,
    borrowedUsdLatestPriceUsdE18,
    borrowedUsdLatestPriceAt,
    borrowedUsdLatestPriceChainId,
    borrowedUsdLatestPriceSource,
    repaidCount: current.repaidCount + (delta.repaidCount ?? 0n),
    repaidAmount: current.repaidAmount + (delta.repaidAmount ?? 0n),
    repaidUsd: current.repaidUsd + (delta.repaidUsd ?? 0n),
    ...latest,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    updatedTransactionHash: lower(event.transaction.hash),
    updatedLogIndex: event.logIndex,
  });
}

async function recordSpendTokenValuations(
  context: any,
  event: BlockEvent,
  spendId: string,
  tokenAddresses: readonly string[],
  amounts: readonly bigint[],
  amountsUsd: readonly bigint[],
) {
  for (let tokenIndex = 0; tokenIndex < tokenAddresses.length; tokenIndex += 1) {
    const rawAddress = tokenAddresses[tokenIndex];
    const amount = amounts[tokenIndex];
    const amountUsd = amountsUsd[tokenIndex];
    if (rawAddress === undefined || amount === undefined || amountUsd === undefined) continue;

    const tokenAddress = lower(rawAddress);
    const token = await recordToken(context, event, tokenAddress);
    const verifiedDecimals = token.decimalsVerified;
    const id = `${spendId}:${tokenIndex}`;
    const priceUsdE18 = verifiedDecimals ? impliedUsdPriceE18(amount, amountUsd, token.decimals) : 0n;
    const priceStatus =
      amount === 0n ? "zero_amount" : verifiedDecimals ? "spend_implied" : "unavailable_unverified_decimals";
    context.SpendTokenValuation.set({
      id,
      chainId: event.chainId,
      spendId,
      tokenAddress,
      tokenIndex,
      amount,
      amountUsd,
      tokenDecimals: token.decimals,
      usdDecimals: 6,
      priceUsdE18,
      priceStatus,
      blockNumber: asBigInt(event.block.number),
      timestamp: ts(event),
      transactionHash: lower(event.transaction.hash),
      logIndex: event.logIndex,
    });
    const priceSourceId = `${event.chainId}:${tokenAddress}:event_implied`;
    context.TokenPriceSource.set({
      id: priceSourceId,
      chainId: event.chainId,
      tokenId: `${event.chainId}:${tokenAddress}`,
      tokenAddress,
      token_id: `${event.chainId}:${tokenAddress}`,
      sourceKind: "event_implied",
      sourceType: "event_implied",
      sourceIdentifier: spendId,
      updatedAt: ts(event),
    });
    context.TokenPriceObservation.set({
      id: `${id}:event_implied`,
      chainId: event.chainId,
      tokenId: `${event.chainId}:${tokenAddress}`,
      tokenAddress,
      token_id: `${event.chainId}:${tokenAddress}`,
      sourceId: priceSourceId,
      ...(priceStatus === "spend_implied" ? { priceUsdE18 } : {}),
      amountUsd,
      valuationStatus: priceStatus === "spend_implied" ? "event_priced" : "unpriced",
      priceStatus,
      observedAt: ts(event),
      blockNumber: asBigInt(event.block.number),
    });
    if (priceStatus === "spend_implied") {
      const currentPrice = await context.TokenPriceCurrent.get(`${event.chainId}:${tokenAddress}`);
      if (currentPrice?.priceUsdE18 && priceDeviationOverHalf(priceUsdE18, currentPrice.priceUsdE18)) {
        context.PriceAnomaly.set({
          id: `${id}:event_implied:deviation`,
          chainId: event.chainId,
          tokenId: `${event.chainId}:${tokenAddress}`,
          tokenAddress,
          observationId: currentPrice.observationId ?? `${id}:event_implied`,
          candidateObservationId: `${id}:event_implied`,
          verificationStatus: "unverified_deviation",
          reason: "event-implied price deviates by more than 50 percent from the last indexed price",
          observedAt: ts(event),
        });
      } else
        context.TokenPriceCurrent.set({
          id: `${event.chainId}:${tokenAddress}`,
          chainId: event.chainId,
          tokenAddress,
          token_id: `${event.chainId}:${tokenAddress}`,
          tokenId: `${event.chainId}:${tokenAddress}`,
          observationId: `${id}:event_implied`,
          priceUsdE18,
          priceUsd: priceUsdE18,
          priceStatus: "event_priced",
          sourceType: "event_implied",
          valuationStatus: "event_priced",
          observedAt: ts(event),
          expiresAt: new Date(ts(event).getTime() + 900_000),
          updatedAt: ts(event),
          updatedBlock: asBigInt(event.block.number),
        });
    }
    const candidate = {
      timestamp: event.block.timestamp,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      id,
    };
    const metric = await context.TokenAnalyticsMetric.get(`${event.chainId}:${tokenAddress}`);
    const metricCurrent = {
      timestamp: metric ? metric.latestSpendAt.getTime() / 1000 : 0,
      blockNumber: metric?.latestSpendBlockNumber ?? 0n,
      logIndex: metric?.latestSpendLogIndex ?? 0,
      id: metric?.latestSpendValuationId ?? "",
    };
    await updateTokenAnalytics(context, event, tokenAddress, {
      spendCount: 1n,
      spendAmount: amount,
      spendUsd: amountUsd,
      ...(isLaterTokenSpend(candidate, metricCurrent)
        ? {
            latestSpendPriceUsdE18: priceUsdE18,
            latestSpendPriceStatus: priceStatus,
            latestSpendAt: ts(event),
            latestSpendBlockNumber: asBigInt(event.block.number),
            latestSpendLogIndex: event.logIndex,
            latestSpendValuationId: id,
          }
        : {}),
    });
    const tokenCurrent = {
      timestamp: token.latestSpendAt.getTime() / 1000,
      blockNumber: token.latestSpendBlockNumber,
      logIndex: token.latestSpendLogIndex,
      id: token.latestSpendValuationId,
    };
    await markTokenAnalytics(context, event, tokenAddress, {
      hasSpend: true,
      hasBalance: true,
      ...(isLaterTokenSpend(candidate, tokenCurrent)
        ? {
            latestSpendPriceUsdE18: priceUsdE18,
            latestSpendPriceStatus: priceStatus,
            latestSpendAt: ts(event),
            latestSpendBlockNumber: asBigInt(event.block.number),
            latestSpendLogIndex: event.logIndex,
            latestSpendValuationId: id,
          }
        : {}),
    });
  }
}

async function bumpDaily(context: any, event: BlockEvent, delta: MetricDelta) {
  const id = dailyMetricId(event.chainId, event.block.timestamp);
  const current = (await context.DailyCashMetric.get(id)) ?? {
    id,
    chainId: event.chainId,
    day: dayFromUnixSeconds(event.block.timestamp),
    spendCount: 0n,
    spendUsd: 0n,
    creditSpendUsd: 0n,
    debitSpendUsd: 0n,
    activeCardCount: 0n,
    newCardCount: 0n,
    topUpCount: 0n,
    cashbackUsd: 0n,
    onrampUsd: 0n,
    offrampUsd: 0n,
    borrowedUsd: 0n,
    repaidUsd: 0n,
  };
  context.DailyCashMetric.set({
    ...current,
    spendCount: current.spendCount + (delta.spendCount ?? 0n),
    spendUsd: current.spendUsd + (delta.spendUsd ?? 0n),
    creditSpendUsd: current.creditSpendUsd + (delta.creditSpendUsd ?? 0n),
    debitSpendUsd: current.debitSpendUsd + (delta.debitSpendUsd ?? 0n),
    activeCardCount: current.activeCardCount + (delta.activeCardCount ?? 0n),
    newCardCount: current.newCardCount + (delta.newCardCount ?? 0n),
    topUpCount: current.topUpCount + (delta.topUpCount ?? 0n),
    cashbackUsd: current.cashbackUsd + (delta.cashbackUsd ?? 0n),
    onrampUsd: current.onrampUsd + (delta.onrampUsd ?? 0n),
    offrampUsd: current.offrampUsd + (delta.offrampUsd ?? 0n),
    borrowedUsd: current.borrowedUsd + (delta.borrowedUsd ?? 0n),
    repaidUsd: current.repaidUsd + (delta.repaidUsd ?? 0n),
  });
}

async function trackActiveSafe(
  context: any,
  event: BlockEvent,
  address: string,
): Promise<Pick<MetricDelta, "activeCardCount" | "newCardCount">> {
  const safe = lower(address);
  const activeId = accountId(event.chainId, safe);
  const dailyId = `${dailyMetricId(event.chainId, event.block.timestamp)}:${safe}`;
  const globalDailyId = `${dayFromUnixSeconds(event.block.timestamp)}:${safe}`;
  const [active, daily, globalActive, globalDaily] = await Promise.all([
    context.ActiveSafe.get(activeId),
    context.DailyActiveSafe.get(dailyId),
    context.GlobalActiveSafe.get(safe),
    context.GlobalDailyActiveSafe.get(globalDailyId),
  ]);
  if (!active) {
    context.ActiveSafe.set({
      id: activeId,
      chainId: event.chainId,
      address: safe,
      firstSpendAt: ts(event),
      firstSpendBlock: asBigInt(event.block.number),
      firstSpendTransactionHash: lower(event.transaction.hash),
    });
  }
  if (!daily) {
    context.DailyActiveSafe.set({
      id: dailyId,
      chainId: event.chainId,
      day: dayFromUnixSeconds(event.block.timestamp),
      address: safe,
    });
  }
  if (!globalActive) {
    context.GlobalActiveSafe.set({
      id: safe,
      address: safe,
      firstSpendChainId: event.chainId,
      firstSpendAt: ts(event),
      firstSpendBlock: asBigInt(event.block.number),
      firstSpendTransactionHash: lower(event.transaction.hash),
    });
  }
  if (!globalDaily) {
    context.GlobalDailyActiveSafe.set({
      id: globalDailyId,
      day: dayFromUnixSeconds(event.block.timestamp),
      address: safe,
      firstSpendChainId: event.chainId,
    });
  }
  return { activeCardCount: globalDaily ? 0n : 1n, newCardCount: globalActive ? 0n : 1n };
}

async function bumpSpendDimensions(context: any, event: BlockEvent, amountUsd: bigint) {
  const bucket = spendBucket(amountUsd);
  const bucketId = `${event.chainId}:${bucket.sortOrder}`;
  const currentBucket = (await context.SpendBucketMetric.get(bucketId)) ?? {
    id: bucketId,
    chainId: event.chainId,
    bucket: bucket.label,
    sortOrder: bucket.sortOrder,
    spendCount: 0n,
    spendUsd: 0n,
  };
  context.SpendBucketMetric.set({
    ...currentBucket,
    spendCount: currentBucket.spendCount + 1n,
    spendUsd: currentBucket.spendUsd + amountUsd,
  });

  const hour = hourFromUnixSeconds(event.block.timestamp);
  const hourId = `${event.chainId}:${hour}`;
  const currentHour = (await context.HourlySpendMetric.get(hourId)) ?? {
    id: hourId,
    chainId: event.chainId,
    hour,
    spendCount: 0n,
    spendUsd: 0n,
  };
  context.HourlySpendMetric.set({
    ...currentHour,
    spendCount: currentHour.spendCount + 1n,
    spendUsd: currentHour.spendUsd + amountUsd,
  });
}

async function recordSpendMetrics(context: any, event: BlockEvent, safe: string, amountUsd: bigint, mode: number) {
  const active = await trackActiveSafe(context, event, safe);
  await Promise.all([
    bumpDaily(context, event, {
      spendCount: 1n,
      spendUsd: amountUsd,
      ...(mode === 0 ? { creditSpendUsd: amountUsd } : mode === 1 ? { debitSpendUsd: amountUsd } : {}),
      ...active,
    }),
    bumpSpendDimensions(context, event, amountUsd),
  ]);
}

async function bumpDestinationBalance(
  context: any,
  event: BlockEvent,
  safe: string,
  token: string,
  inflow: bigint,
  outflow: bigint,
  analyticsDelta: TokenAnalyticsDelta = {},
) {
  const normalizedSafe = lower(safe);
  const normalizedToken = lower(token);
  const id = `${event.chainId}:${normalizedSafe}:${normalizedToken}`;
  const existing = await context.AccountTokenBalance.get(id);
  const current = existing ?? {
    id,
    chainId: event.chainId,
    accountAddress: normalizedSafe,
    accountKind: "destination_cash",
    tokenAddress: normalizedToken,
    amount: 0n,
    inflow: 0n,
    outflow: 0n,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  };
  const nextAmount = applyBalanceDelta(current.amount, inflow, outflow);
  context.AccountTokenBalance.set({
    ...current,
    amount: nextAmount,
    inflow: current.inflow + inflow,
    outflow: current.outflow + outflow,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
  await updateTokenAnalytics(context, event, normalizedToken, {
    destinationCount: existing ? 0n : 1n,
    destinationBalance: balanceChange(current.amount, nextAmount),
    destinationInflow: inflow,
    destinationOutflow: outflow,
    ...analyticsDelta,
  });
}

async function debitSpendBalances(
  context: any,
  event: BlockEvent,
  safe: string,
  tokens: readonly string[],
  amounts: readonly bigint[],
) {
  const totals = new Map<string, bigint>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const amount = amounts[index];
    if (token === undefined || amount === undefined) continue;
    const normalizedToken = lower(token);
    totals.set(normalizedToken, (totals.get(normalizedToken) ?? 0n) + amount);
  }
  for (const [token, amount] of totals) {
    await bumpDestinationBalance(context, event, safe, token, 0n, amount);
  }
}

function protocolEvent(event: BlockEvent, eventType: string, fields: Partial<Record<string, unknown>> = {}) {
  return {
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    contractAddress: lower(event.srcAddress),
    eventType,
    actor: ZERO_ADDRESS,
    tokenAddress: ZERO_ADDRESS,
    amount: 0n,
    amountUsd: 0n,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(event),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
    metadata: "{}",
    ...fields,
  };
}

// Canonical Cash Explorer rows. Event payloads remain the primary source;
// missing USD/state may be enriched through cached, chain-scoped Envio effects
// anchored to the indexed block.
async function canonicalAccount(context: any, event: BlockEvent, rawAddress: string) {
  const address = lower(rawAddress);
  const current = await context.AccountIdentity.get(address);
  if (!current)
    context.AccountIdentity.set({
      id: address,
      address,
      identityKind: "safe",
      firstSeenAt: ts(event),
      firstSeenChainId: event.chainId,
      updatedAt: ts(event),
    });
  else context.AccountIdentity.set({ ...current, updatedAt: ts(event) });
  const chainAccountId = `${event.chainId}:${address}`;
  const chainAccount = await context.Account.get(chainAccountId);
  context.Account.set(
    chainAccount ?? {
      id: chainAccountId,
      chainId: event.chainId,
      address,
      identity_id: address,
      firstSeenAt: ts(event),
      updatedAt: ts(event),
    },
  );
  return address;
}

async function canonicalAction(
  context: any,
  event: BlockEvent,
  actionType: string,
  rawAccount?: string,
  amountUsd?: bigint,
  metadata = "{}",
  idSuffix = "",
) {
  const sourceEventId = eventId(event.chainId, event.transaction.hash, event.logIndex);
  const id = `${sourceEventId}${idSuffix}`;
  const accountAddress = rawAccount ? await canonicalAccount(context, event, rawAccount) : undefined;
  context.EconomicAction.set({
    id,
    chainId: event.chainId,
    ...(accountAddress ? { accountIdentityId: accountAddress, accountAddress } : {}),
    actionType,
    transactionHash: lower(event.transaction.hash),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(event),
    logIndex: event.logIndex,
    ...(amountUsd === undefined ? {} : { amountUsd }),
    valuationStatus: amountUsd === undefined ? "unpriced" : "event_priced",
    sourceCount: 1,
    economicKey: `${event.chainId}:${lower(event.transaction.hash)}:${event.logIndex}${idSuffix}:${actionType}`,
    metadata,
  });
  context.EconomicActionSource.set({
    id: `${id}:event`,
    economicActionId: id,
    sourceEventId,
    sourceKind: "envio_event",
    sourceRole: "primary",
  });
  context.ScannerEvent.set({
    id,
    chainId: event.chainId,
    eventType: actionType,
    contractAddress: lower(event.srcAddress),
    ...(accountAddress ? { actorAddress: accountAddress } : {}),
    transactionHash: lower(event.transaction.hash),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(event),
    logIndex: event.logIndex,
    ...(amountUsd === undefined ? {} : { amountUsd }),
    usdStatus: amountUsd === undefined ? "unpriced" : "priced",
  });
  return { id, accountAddress };
}

type CanonicalValuation = {
  amountUsd?: bigint;
  priceUsdE18?: bigint;
  tokenDecimals: number;
  status: string;
  source: string;
};

type CanonicalPriceCandidate = {
  priceUsdE18: bigint;
  sourceType: "canonical_asset_bucket" | "cross_chain_event" | "cross_chain_price_provider";
  status: "canonical_bucket_priced" | "cross_chain_event_priced" | "cross_chain_oracle_priced";
  referenceChainId: number;
  referenceTokenAddress: string;
  referenceBlockNumber: bigint;
  referenceBlockHash: string;
  referenceLogIndex: number;
  referenceObservedAt: Date;
  referenceObservationId: string;
};

async function persistCanonicalBucketPrice(
  context: any,
  event: BlockEvent,
  tokenAddress: string,
  tokenDecimals: number,
  amount: bigint,
  current: any,
  candidate: CanonicalPriceCandidate,
): Promise<CanonicalValuation | null> {
  const observedAt = ts(event);
  const id = `${event.chainId}:${lower(tokenAddress)}`;
  const sourceId = `${id}:${candidate.sourceType}:${candidate.referenceChainId}:${candidate.referenceTokenAddress}`;
  const observationId = `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${lower(tokenAddress)}:${candidate.sourceType}`;
  context.TokenPriceSource.set({
    id: sourceId,
    chainId: event.chainId,
    tokenId: id,
    tokenAddress: lower(tokenAddress),
    token_id: id,
    sourceKind: candidate.sourceType,
    sourceType: candidate.sourceType,
    sourceIdentifier: `${candidate.referenceChainId}:${candidate.referenceTokenAddress}`,
    sourceAddress: candidate.referenceTokenAddress,
    updatedAt: observedAt,
  });
  context.TokenPriceObservation.set({
    id: observationId,
    chainId: event.chainId,
    tokenId: id,
    tokenAddress: lower(tokenAddress),
    token_id: id,
    sourceId,
    priceUsdE18: candidate.priceUsdE18,
    valuationStatus: candidate.status,
    priceStatus: candidate.status,
    observedAt,
    blockNumber: asBigInt(event.block.number),
    referenceChainId: candidate.referenceChainId,
    referenceTokenAddress: candidate.referenceTokenAddress,
    referenceBlockNumber: candidate.referenceBlockNumber,
    referenceObservedAt: candidate.referenceObservedAt,
  });

  if (
    current?.priceUsdE18 &&
    current.observationId &&
    priceDeviationOverHalf(candidate.priceUsdE18, current.priceUsdE18)
  ) {
    context.PriceAnomaly.set({
      id: `${observationId}:deviation`,
      chainId: event.chainId,
      tokenId: id,
      tokenAddress: lower(tokenAddress),
      observationId: current.observationId,
      candidateObservationId: observationId,
      verificationStatus: "unverified_deviation",
      reason: "canonical bucket candidate deviates by more than 50 percent from the last indexed price",
      observedAt,
    });
    return null;
  }

  context.TokenPriceCurrent.set({
    id,
    chainId: event.chainId,
    tokenAddress: lower(tokenAddress),
    token_id: id,
    tokenId: id,
    observationId,
    priceUsdE18: candidate.priceUsdE18,
    priceUsd: candidate.priceUsdE18,
    priceStatus: candidate.status,
    sourceType: candidate.sourceType,
    valuationStatus: candidate.status,
    observedAt,
    expiresAt: new Date(candidate.referenceObservedAt.getTime() + 900_000),
    updatedAt: observedAt,
    updatedBlock: asBigInt(event.block.number),
    referenceChainId: candidate.referenceChainId,
    referenceTokenAddress: candidate.referenceTokenAddress,
    referenceBlockNumber: candidate.referenceBlockNumber,
    referenceObservedAt: candidate.referenceObservedAt,
  });
  return {
    amountUsd: amountAtPrice(amount, candidate.priceUsdE18, tokenDecimals),
    priceUsdE18: candidate.priceUsdE18,
    tokenDecimals,
    status: candidate.status,
    source: candidate.sourceType,
  };
}

async function resolveCanonicalBucketValuation(
  context: any,
  event: BlockEvent,
  tokenAddress: string,
  tokenDecimals: number,
  amount: bigint,
  current: any,
): Promise<CanonicalValuation | null> {
  const canonicalAsset = verifiedCanonicalPriceAsset(event.chainId, tokenAddress);
  if (!canonicalAsset) return null;
  const observedAt = ts(event);
  const bucketId = fifteenMinuteBucketId(event.block.timestamp);

  let bucketCandidate: CanonicalPriceCandidate | null = null;
  for (const candidateBucketId of [bucketId, bucketId - 1n]) {
    const bucket: any = await context.CanonicalAssetPriceBucket.get(
      canonicalAssetPriceBucketId(canonicalAsset, candidateBucketId),
    );
    if (
      bucket?.canonicalAsset !== canonicalAsset ||
      !bucket?.priceUsdE18 ||
      bucket.priceUsdE18 <= 0n ||
      !isFreshNonFuturePrice(event.block.timestamp, BigInt(Math.floor(bucket.sourceTimestamp.getTime() / 1000)))
    )
      continue;
    const crossChain = bucket.sourceChainId !== event.chainId;
    const sourceWasEvent = bucket.sourceType === "event_implied";
    const candidate: CanonicalPriceCandidate = {
      priceUsdE18: bucket.priceUsdE18,
      sourceType: crossChain
        ? sourceWasEvent
          ? "cross_chain_event"
          : "cross_chain_price_provider"
        : "canonical_asset_bucket",
      status: crossChain
        ? sourceWasEvent
          ? "cross_chain_event_priced"
          : "cross_chain_oracle_priced"
        : "canonical_bucket_priced",
      referenceChainId: bucket.sourceChainId,
      referenceTokenAddress: bucket.sourceTokenAddress,
      referenceBlockNumber: bucket.sourceBlockNumber,
      referenceBlockHash: bucket.sourceBlockHash,
      referenceLogIndex: bucket.sourceLogIndex,
      referenceObservedAt: bucket.sourceTimestamp,
      referenceObservationId: bucket.sourceObservationId,
    };
    if (!bucketCandidate || candidate.referenceObservedAt > bucketCandidate.referenceObservedAt)
      bucketCandidate = candidate;
  }
  if (bucketCandidate)
    return persistCanonicalBucketPrice(context, event, tokenAddress, tokenDecimals, amount, current, bucketCandidate);
  return null;
}

type CanonicalBucketSource = {
  blockNumber: bigint;
  blockHash: string;
  logIndex: number;
  observedAt: Date;
  sourceType: "event_implied" | "price_provider";
  observationId: string;
};

function canonicalBucketCandidateIsLater(
  existing: any,
  candidate: CanonicalBucketSource,
  sourceChainId: number,
  sourceTokenAddress: string,
): boolean {
  if (!existing) return true;
  const existingTimestamp = existing.sourceTimestamp.getTime();
  const candidateTimestamp = candidate.observedAt.getTime();
  if (candidateTimestamp !== existingTimestamp) return candidateTimestamp > existingTimestamp;
  if (candidate.blockNumber !== existing.sourceBlockNumber) return candidate.blockNumber > existing.sourceBlockNumber;
  if (candidate.logIndex !== existing.sourceLogIndex) return candidate.logIndex > existing.sourceLogIndex;
  if (sourceChainId !== existing.sourceChainId) return sourceChainId < existing.sourceChainId;
  const normalizedTokenAddress = lower(sourceTokenAddress);
  if (normalizedTokenAddress !== existing.sourceTokenAddress)
    return normalizedTokenAddress < existing.sourceTokenAddress;
  return candidate.observationId < existing.sourceObservationId;
}

async function publishCanonicalAssetPriceBucket(
  context: any,
  event: BlockEvent,
  tokenAddress: string,
  priceUsdE18: bigint,
  source: CanonicalBucketSource,
) {
  const canonicalAsset = verifiedCanonicalPriceAsset(event.chainId, tokenAddress);
  if (!canonicalAsset || priceUsdE18 <= 0n) return;
  const numericBucketId = fifteenMinuteBucketId(BigInt(Math.floor(source.observedAt.getTime() / 1000)));
  const id = canonicalAssetPriceBucketId(canonicalAsset, numericBucketId);
  const existing = await context.CanonicalAssetPriceBucket.get(id);
  if (!canonicalBucketCandidateIsLater(existing, source, event.chainId, tokenAddress)) return;
  context.CanonicalAssetPriceBucket.set({
    id,
    canonicalAsset,
    bucketId: numericBucketId,
    bucketStart: new Date(Number(numericBucketId * 900n) * 1000),
    priceUsdE18,
    sourceChainId: event.chainId,
    sourceTokenAddress: lower(tokenAddress),
    sourceBlockNumber: source.blockNumber,
    sourceBlockHash: lower(source.blockHash),
    sourceLogIndex: source.logIndex,
    sourceTimestamp: source.observedAt,
    sourceType: source.sourceType,
    sourceObservationId: source.observationId,
  });
}

async function resolveCanonicalValuation(
  context: any,
  event: BlockEvent,
  tokenAddress: string,
  amount: bigint,
  emittedAmountUsd?: bigint,
): Promise<CanonicalValuation> {
  const token = await recordToken(context, event, tokenAddress);
  if (emittedAmountUsd !== undefined) {
    const priceUsdE18 = token.decimalsVerified
      ? impliedUsdPriceE18(amount, emittedAmountUsd, token.decimals)
      : undefined;
    if (priceUsdE18 && priceUsdE18 > 0n) {
      const tokenId = `${event.chainId}:${lower(tokenAddress)}`;
      const sourceId = `${tokenId}:event_implied`;
      const observationId = `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${lower(tokenAddress)}:event_implied`;
      const observedAt = ts(event);
      context.TokenPriceSource.set({
        id: sourceId,
        chainId: event.chainId,
        tokenId,
        tokenAddress: lower(tokenAddress),
        token_id: tokenId,
        sourceKind: "event_implied",
        sourceType: "event_implied",
        sourceIdentifier: lower(event.srcAddress),
        sourceAddress: lower(event.srcAddress),
        updatedAt: observedAt,
      });
      context.TokenPriceObservation.set({
        id: observationId,
        chainId: event.chainId,
        tokenId,
        tokenAddress: lower(tokenAddress),
        token_id: tokenId,
        sourceId,
        priceUsdE18,
        amountUsd: emittedAmountUsd,
        valuationStatus: "event_priced",
        priceStatus: "event_priced",
        observedAt,
        blockNumber: asBigInt(event.block.number),
      });
      const currentPrice = await context.TokenPriceCurrent.get(tokenId);
      if (currentPrice?.priceUsdE18 && priceDeviationOverHalf(priceUsdE18, currentPrice.priceUsdE18)) {
        context.PriceAnomaly.set({
          id: `${observationId}:deviation`,
          chainId: event.chainId,
          tokenId,
          tokenAddress: lower(tokenAddress),
          observationId: currentPrice.observationId ?? observationId,
          candidateObservationId: observationId,
          verificationStatus: "unverified_deviation",
          reason: "event-implied price deviates by more than 50 percent from the last indexed price",
          observedAt,
        });
      } else {
        context.TokenPriceCurrent.set({
          id: tokenId,
          chainId: event.chainId,
          tokenAddress: lower(tokenAddress),
          token_id: tokenId,
          tokenId,
          observationId,
          priceUsdE18,
          priceUsd: priceUsdE18,
          priceStatus: "event_priced",
          sourceType: "event_implied",
          valuationStatus: "event_priced",
          observedAt,
          expiresAt: new Date(observedAt.getTime() + 900_000),
          updatedAt: observedAt,
          updatedBlock: asBigInt(event.block.number),
        });
        const canonicalAsset = verifiedCanonicalPriceAsset(event.chainId, tokenAddress);
        if (canonicalAsset) {
          const bucketStart = fifteenMinuteBucket(observedAt);
          const bucketId = tokenPriceBucketId(event.chainId, tokenAddress, bucketStart);
          const existingBucket = await context.CanonicalTokenPriceBucket.get(bucketId);
          const shouldReplace =
            !existingBucket ||
            existingBucket.observedAt.getTime() < observedAt.getTime() ||
            (existingBucket.observedAt.getTime() === observedAt.getTime() &&
              (existingBucket.blockNumber < asBigInt(event.block.number) ||
                (existingBucket.blockNumber === asBigInt(event.block.number) &&
                  existingBucket.logIndex < event.logIndex)));
          if (shouldReplace)
            context.CanonicalTokenPriceBucket.set({
              id: bucketId,
              canonicalAsset,
              chainId: event.chainId,
              tokenAddress: lower(tokenAddress),
              tokenId,
              token_id: tokenId,
              priceUsdE18,
              observedAt,
              bucketStart: new Date(bucketStart),
              blockNumber: asBigInt(event.block.number),
              logIndex: event.logIndex,
              sourceType: "event_implied",
            });
        }
        await publishCanonicalAssetPriceBucket(context, event, tokenAddress, priceUsdE18, {
          blockNumber: asBigInt(event.block.number),
          blockHash: event.block.hash,
          logIndex: event.logIndex,
          observedAt,
          sourceType: "event_implied",
          observationId,
        });
      }
    }
    return {
      amountUsd: emittedAmountUsd,
      ...(priceUsdE18 && priceUsdE18 > 0n ? { priceUsdE18 } : {}),
      tokenDecimals: token.decimals,
      status: "event_priced",
      source: "event",
    };
  }

  const id = `${event.chainId}:${lower(tokenAddress)}`;
  const current = await context.TokenPriceCurrent.get(id);
  const observedAt = ts(event);
  if (
    current?.priceUsdE18 &&
    current.priceUsdE18 > 0n &&
    current.observedAt &&
    current.observedAt.getTime() <= observedAt.getTime() &&
    current.expiresAt &&
    current.expiresAt.getTime() >= observedAt.getTime()
  ) {
    return {
      amountUsd: amountAtPrice(amount, current.priceUsdE18, token.decimals),
      priceUsdE18: current.priceUsdE18,
      tokenDecimals: token.decimals,
      status: "cached_price",
      source: current.sourceType,
    };
  }
  const canonicalBucket = await resolveCanonicalBucketValuation(
    context,
    event,
    tokenAddress,
    token.decimals,
    amount,
    current,
  );
  if (canonicalBucket) return canonicalBucket;
  const bucketStart = fifteenMinuteBucket(observedAt);
  const expiresAt = new Date(new Date(bucketStart).getTime() + 900_000);
  const effect = priceProviderAvailableAtBlock(event.chainId, asBigInt(event.block.number))
    ? await context.effect(currentTokenPriceEffect, {
        tokenAddress: lower(tokenAddress),
        bucketStart,
        blockNumber: String(event.block.number),
        blockHash: event.block.hash,
        blockTimestamp: String(event.block.timestamp),
      })
    : { status: "unavailable", valueJson: "null" };
  if (effect.status !== "resolved") {
    context.TokenPriceCurrent.set({
      ...(current ?? {}),
      id,
      chainId: event.chainId,
      tokenAddress: lower(tokenAddress),
      token_id: id,
      tokenId: id,
      priceStatus: "unavailable",
      sourceType: "all_price_sources_unavailable",
      valuationStatus: "unpriced",
      observedAt,
      expiresAt,
      updatedAt: observedAt,
      updatedBlock: asBigInt(event.block.number),
    });
    return { tokenDecimals: token.decimals, status: "unpriced", source: "all_price_sources_unavailable" };
  }

  let priceUsdE18: bigint;
  let sourceBlockNumber: bigint;
  let sourceBlockHash: string;
  let sourceTimestampSeconds: bigint;
  let sourceObservedAt: Date;
  try {
    const parsed = JSON.parse(effect.valueJson) as {
      priceUsdE18?: string;
      sourceBlockNumber?: string;
      sourceBlockHash?: string;
      sourceTimestampSeconds?: string;
    };
    priceUsdE18 = BigInt(parsed.priceUsdE18 ?? "0");
    sourceBlockNumber = BigInt(parsed.sourceBlockNumber ?? "");
    sourceBlockHash = parsed.sourceBlockHash ?? "";
    sourceTimestampSeconds = BigInt(parsed.sourceTimestampSeconds ?? "");
    sourceObservedAt = new Date(Number(sourceTimestampSeconds) * 1000);
    if (
      !/^0x[0-9a-fA-F]{64}$/.test(sourceBlockHash) ||
      Number.isNaN(sourceObservedAt.getTime()) ||
      sourceBlockNumber !== asBigInt(event.block.number) ||
      sourceBlockHash.toLowerCase() !== event.block.hash.toLowerCase() ||
      sourceTimestampSeconds !== asBigInt(event.block.timestamp)
    )
      throw new Error();
  } catch {
    return { tokenDecimals: token.decimals, status: "unpriced", source: "invalid_effect_result" };
  }
  if (priceUsdE18 <= 0n) {
    return { tokenDecimals: token.decimals, status: "unpriced", source: "price_provider_zero" };
  }

  const sourceId = `${event.chainId}:${lower(tokenAddress)}:price_provider`;
  const observationId = `${sourceId}:${sourceBlockNumber}`;
  context.TokenPriceSource.set({
    id: sourceId,
    chainId: event.chainId,
    tokenId: id,
    tokenAddress: lower(tokenAddress),
    token_id: id,
    sourceKind: "price_provider",
    sourceType: "price_provider",
    sourceIdentifier: "0x44dd2372fe7b97c4b4d6a7d4decf72466485bacb",
    sourceAddress: "0x44dd2372fe7b97c4b4d6a7d4decf72466485bacb",
    updatedAt: observedAt,
  });
  context.TokenPriceObservation.set({
    id: observationId,
    chainId: event.chainId,
    tokenId: id,
    tokenAddress: lower(tokenAddress),
    token_id: id,
    sourceId,
    priceUsdE18,
    valuationStatus: "oracle_priced",
    priceStatus: "oracle_priced",
    observedAt: sourceObservedAt,
    blockNumber: sourceBlockNumber,
  });

  if (current?.priceUsdE18 && priceDeviationOverHalf(priceUsdE18, current.priceUsdE18)) {
    context.PriceAnomaly.set({
      id: `${observationId}:deviation`,
      chainId: event.chainId,
      tokenId: id,
      tokenAddress: lower(tokenAddress),
      observationId,
      candidateObservationId: observationId,
      verificationStatus: "unverified_deviation",
      reason: "candidate price deviates by more than 50 percent from the last indexed price",
      observedAt,
    });
    return { tokenDecimals: token.decimals, status: "unpriced", source: "price_anomaly" };
  }

  context.TokenPriceCurrent.set({
    id,
    chainId: event.chainId,
    tokenAddress: lower(tokenAddress),
    token_id: id,
    tokenId: id,
    observationId,
    priceUsdE18,
    priceUsd: priceUsdE18,
    priceStatus: "oracle_priced",
    sourceType: "price_provider",
    valuationStatus: "oracle_priced",
    observedAt: sourceObservedAt,
    expiresAt: new Date(sourceObservedAt.getTime() + 900_000),
    updatedAt: observedAt,
    updatedBlock: asBigInt(event.block.number),
  });
  await publishCanonicalAssetPriceBucket(context, event, tokenAddress, priceUsdE18, {
    blockNumber: sourceBlockNumber,
    blockHash: sourceBlockHash,
    logIndex: -1,
    observedAt: sourceObservedAt,
    sourceType: "price_provider",
    observationId,
  });
  return {
    amountUsd: amountAtPrice(amount, priceUsdE18, token.decimals),
    priceUsdE18,
    tokenDecimals: token.decimals,
    status: "oracle_priced",
    source: "price_provider",
  };
}

async function canonicalTokenLeg(
  context: any,
  event: BlockEvent,
  actionId: string,
  rawAccount: string,
  rawToken: string,
  legIndex: number,
  eventType: string,
  direction: "in" | "out" | "neutral",
  amount: bigint,
  amountUsd?: bigint,
  fundingMode?: string,
  options: { status?: string; cashbackType?: string; affectsSafeBalance?: boolean; createScannerLeg?: boolean } = {},
) {
  const accountAddress = await canonicalAccount(context, event, rawAccount);
  const tokenAddress = lower(rawToken);
  const id = `${actionId}:${legIndex}`;
  const valuation = await resolveCanonicalValuation(context, event, tokenAddress, amount, amountUsd);
  const resolvedAmountUsd = valuation.amountUsd;
  const category =
    eventType.startsWith("topup") || eventType === "deposit"
      ? "deposit"
      : eventType.startsWith("repay")
        ? "repayment"
        : eventType.includes("liquidation")
          ? "repayment"
          : eventType.startsWith("cashback")
            ? "cashback"
            : eventType.startsWith("withdrawal")
              ? "withdrawal"
              : eventType === "spend" || eventType === "borrow" || eventType === "fee"
                ? eventType
                : "other";
  context.AccountTokenEvent.set({
    id,
    chainId: event.chainId,
    accountIdentityId: accountAddress,
    accountAddress,
    tokenAddress,
    economicActionId: actionId,
    account_id: `${event.chainId}:${accountAddress}`,
    token_id: `${event.chainId}:${tokenAddress}`,
    legIndex,
    eventType,
    category,
    direction,
    ...(fundingMode ? { fundingMode } : {}),
    status: options.status ?? "completed",
    amount,
    amountRaw: amount,
    tokenDecimals: valuation.tokenDecimals,
    ...(resolvedAmountUsd === undefined ? {} : { amountUsd: resolvedAmountUsd }),
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    ...(valuation.priceUsdE18 === undefined ? {} : { priceUsdE18: valuation.priceUsdE18 }),
    ...(options.cashbackType ? { cashbackType: options.cashbackType } : {}),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(event),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  if (options.createScannerLeg !== false)
    context.ScannerEventTokenLeg.set({
      id,
      scannerEvent_id: actionId,
      token_id: `${event.chainId}:${tokenAddress}`,
      legIndex,
      tokenAddress,
      amount,
      ...(resolvedAmountUsd === undefined ? {} : { amountUsd: resolvedAmountUsd }),
      direction,
      priceStatus: valuation.status,
    });
  const metricId = `${event.chainId}:${accountAddress}:${tokenAddress}`;
  const exactWallet = await context.SafeTokenBalance.get(metricId);
  if (exactWallet && valuation.priceUsdE18)
    await applyExactWalletBalance(context, event, accountAddress, tokenAddress, exactWallet.amount, valuation);
  const existing = await context.AccountTokenMetric.get(metricId);
  const current = existing ?? initialAccountTokenMetric(event, accountAddress, tokenAddress);
  if (!existing) {
    const accountMetric = await ensureAccountMetric(context, event, accountAddress);
    context.AccountMetric.set({ ...accountMetric, tokenCount: accountMetric.tokenCount + 1n });
  }
  const affectsSafeBalance = options.affectsSafeBalance ?? (category !== "borrow" && category !== "repayment");
  const inflow = direction === "in" ? amount : 0n;
  const outflow = direction === "out" ? amount : 0n;
  const safeInflow = affectsSafeBalance ? inflow : 0n;
  const safeOutflow = affectsSafeBalance ? outflow : 0n;
  const addUsd = (currentValue: bigint | undefined, applies: boolean) =>
    !applies ? currentValue : resolvedAmountUsd === undefined ? undefined : (currentValue ?? 0n) + resolvedAmountUsd;
  const isCompleted = (options.status ?? "completed") === "completed";
  const isDeposit = category === "deposit" && isCompleted;
  const isSpend = category === "spend" && isCompleted;
  const isWithdrawal = category === "withdrawal" && isCompleted;
  const isCashback = category === "cashback" && isCompleted && direction === "in";
  const isBorrow = category === "borrow" && isCompleted;
  const isRepayment = category === "repayment" && isCompleted;
  context.AccountTokenMetric.set({
    ...current,
    balance: applyBalanceDelta(current.balance, inflow, outflow),
    inflow: current.inflow + inflow,
    outflow: current.outflow + outflow,
    safeBalanceAmount: applyBalanceDelta(current.safeBalanceAmount, safeInflow, safeOutflow),
    safeInflowAmount: current.safeInflowAmount + safeInflow,
    safeOutflowAmount: current.safeOutflowAmount + safeOutflow,
    depositCount: current.depositCount + (isDeposit ? 1n : 0n),
    depositedAmount: current.depositedAmount + (isDeposit ? inflow : 0n),
    depositedUsd: addUsd(current.depositedUsd, isDeposit),
    spendCount: current.spendCount + (isSpend ? 1n : 0n),
    spentAmount: current.spentAmount + (isSpend ? outflow : 0n),
    spentUsd: addUsd(current.spentUsd, isSpend),
    creditSpendUsd: addUsd(current.creditSpendUsd, isSpend && fundingMode === "credit"),
    debitSpendUsd: addUsd(current.debitSpendUsd, isSpend && fundingMode === "debit"),
    withdrawalCount: current.withdrawalCount + (isWithdrawal ? 1n : 0n),
    withdrawnAmount: current.withdrawnAmount + (isWithdrawal ? outflow : 0n),
    withdrawnUsd: addUsd(current.withdrawnUsd, isWithdrawal),
    cashbackCount: current.cashbackCount + (isCashback ? 1n : 0n),
    cashbackAmount: current.cashbackAmount + (isCashback ? inflow : 0n),
    cashbackUsd: addUsd(current.cashbackUsd, isCashback),
    borrowedAmount: current.borrowedAmount + (isBorrow ? amount : 0n),
    repaidAmount: current.repaidAmount + (isRepayment ? amount : 0n),
    outstandingDebtAmount: current.outstandingDebtAmount + (isBorrow ? amount : 0n) - (isRepayment ? amount : 0n),
    borrowedUsd: addUsd(current.borrowedUsd, isBorrow),
    repaidUsd: addUsd(current.repaidUsd, isRepayment),
    outstandingDebtUsd:
      isBorrow || isRepayment
        ? resolvedAmountUsd === undefined || current.outstandingDebtUsd === undefined
          ? undefined
          : current.outstandingDebtUsd + (isBorrow ? resolvedAmountUsd : -resolvedAmountUsd)
        : current.outstandingDebtUsd,
    outstandingDebtStatus:
      isBorrow || isRepayment
        ? resolvedAmountUsd === undefined
          ? "event_ledger_unpriced"
          : "event_ledger"
        : current.outstandingDebtStatus,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
  return valuation;
}

function initialAccountTokenMetric(event: BlockEvent, accountAddress: string, tokenAddress: string) {
  return {
    id: `${event.chainId}:${accountAddress}:${tokenAddress}`,
    chainId: event.chainId,
    accountIdentityId: accountAddress,
    accountAddress,
    account_id: `${event.chainId}:${accountAddress}`,
    tokenAddress,
    token_id: `${event.chainId}:${tokenAddress}`,
    balance: 0n,
    inflow: 0n,
    outflow: 0n,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    safeBalanceAmount: 0n,
    safeInflowAmount: 0n,
    safeOutflowAmount: 0n,
    usdStatus: "unpriced",
    currentBalanceValuationStatus: "pending",
    depositCount: 0n,
    depositedAmount: 0n,
    spendCount: 0n,
    spentAmount: 0n,
    withdrawalCount: 0n,
    withdrawnAmount: 0n,
    cashbackCount: 0n,
    cashbackAmount: 0n,
    depositedUsd: 0n,
    spentUsd: 0n,
    creditSpendUsd: 0n,
    debitSpendUsd: 0n,
    withdrawnUsd: 0n,
    cashbackUsd: 0n,
    borrowedUsd: 0n,
    repaidUsd: 0n,
    outstandingDebtUsd: 0n,
    outstandingDebtStatus: "unavailable",
    borrowedAmount: 0n,
    repaidAmount: 0n,
    outstandingDebtAmount: 0n,
    otherInflowAmount: 0n,
    otherOutflowAmount: 0n,
    firstActivityAt: ts(event),
    lastActivityAt: ts(event),
  };
}

type AccountMetricDelta = {
  depositedUsd?: bigint | null;
  spendUsd?: bigint | null;
  withdrawnUsd?: bigint | null;
  cashbackReceivedUsd?: bigint | null;
  cashbackGeneratedUsd?: bigint | null;
  cashbackGeneratedForOthersUsd?: bigint | null;
  cashbackRegularUsd?: bigint | null;
  cashbackSpenderUsd?: bigint | null;
  cashbackPromotionUsd?: bigint | null;
  cashbackReferralUsd?: bigint | null;
  cashbackOtherUsd?: bigint | null;
  creditSpendUsd?: bigint | null;
  debitSpendUsd?: bigint | null;
  borrowedUsd?: bigint | null;
  repaidUsd?: bigint | null;
  topUpCount?: bigint;
};

async function ensureAccountMetric(context: any, event: BlockEvent, rawAccount: string) {
  const accountAddress = await canonicalAccount(context, event, rawAccount);
  const id = `${event.chainId}:${accountAddress}`;
  return (
    (await context.AccountMetric.get(id)) ?? {
      id,
      chainId: event.chainId,
      accountIdentityId: accountAddress,
      accountAddress,
      safeAddress: accountAddress,
      spendUsd: 0n,
      topUpCount: 0n,
      cashbackReceivedUsd: 0n,
      tokenCount: 0n,
      transactionCount: 0n,
      lifetimeDepositedUsd: 0n,
      lifetimeSpentUsd: 0n,
      lifetimeWithdrawnUsd: 0n,
      lifetimeCashbackUsd: 0n,
      lifetimeCashbackGeneratedUsd: 0n,
      lifetimeCashbackReceivedUsd: 0n,
      lifetimeCashbackGeneratedForOthersUsd: 0n,
      lifetimeCashbackRegularUsd: 0n,
      lifetimeCashbackSpenderUsd: 0n,
      lifetimeCashbackPromotionUsd: 0n,
      lifetimeCashbackReferralUsd: 0n,
      lifetimeCashbackOtherUsd: 0n,
      creditSpendUsd: 0n,
      debitSpendUsd: 0n,
      borrowedUsd: 0n,
      repaidUsd: 0n,
      eventLedgerOutstandingDebtUsd: 0n,
      debtStatus: "event_ledger",
      pricedBalanceUsd: 0n,
      unpricedPositionCount: 0n,
      firstActivityAt: ts(event),
      lastActivityAt: ts(event),
      updatedAt: ts(event),
      updatedBlock: asBigInt(event.block.number),
    }
  );
}

async function applyExactWalletBalance(
  context: any,
  event: BlockEvent,
  rawAccount: string,
  rawToken: string,
  nextAmount: bigint,
  knownValuation?: CanonicalValuation,
) {
  const accountAddress = await canonicalAccount(context, event, rawAccount);
  const tokenAddress = lower(rawToken);
  const metricId = `${event.chainId}:${accountAddress}:${tokenAddress}`;
  const existing = await context.AccountTokenMetric.get(metricId);
  const metric = existing ?? initialAccountTokenMetric(event, accountAddress, tokenAddress);
  if (nextAmount === 0n) await recordToken(context, event, tokenAddress);
  // Event handlers that already resolved a price pass it through here. Revalue
  // the exact wallet amount with that price instead of scheduling a duplicate
  // effect. Transfer-only balances still refresh through the bucketed effect.
  const valuation =
    nextAmount <= 0n
      ? undefined
      : knownValuation?.priceUsdE18
        ? {
            ...knownValuation,
            amountUsd: amountAtPrice(nextAmount, knownValuation.priceUsdE18, knownValuation.tokenDecimals),
          }
        : await resolveCanonicalValuation(context, event, tokenAddress, nextAmount);
  const nextUsd = nextAmount === 0n ? 0n : valuation?.amountUsd;
  const previousAmount = metric.currentBalanceAmount ?? 0n;
  const previousUsd = metric.currentBalanceUsd;
  const previousUnpriced = previousAmount > 0n && previousUsd === undefined;
  const nextUnpriced = nextAmount > 0n && nextUsd === undefined;
  context.AccountTokenMetric.set({
    ...metric,
    currentBalanceAmount: nextAmount,
    currentBalanceUsd: nextUsd,
    currentBalanceValuationStatus:
      nextAmount === 0n ? "zero_balance" : nextUsd === undefined ? "unpriced" : "latest_indexed_price",
    safeBalanceAmount: nextAmount,
    usdStatus: nextUsd === undefined ? "unpriced" : "priced",
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
  const account = await ensureAccountMetric(context, event, accountAddress);
  const pricedBalanceUsd = BigInt(account.pricedBalanceUsd) - BigInt(previousUsd ?? 0n) + (nextUsd ?? 0n);
  const unpricedPositionCount =
    BigInt(account.unpricedPositionCount) - (previousUnpriced ? 1n : 0n) + (nextUnpriced ? 1n : 0n);
  const currentBalanceUsd = unpricedPositionCount === 0n ? pricedBalanceUsd : undefined;
  const debt = account.eventLedgerOutstandingDebtUsd;
  context.AccountMetric.set({
    ...account,
    tokenCount: existing ? account.tokenCount : account.tokenCount + 1n,
    pricedBalanceUsd,
    unpricedPositionCount,
    currentBalanceUsd,
    netWorthUsd: currentBalanceUsd === undefined || debt === undefined ? undefined : currentBalanceUsd - debt,
    lastActivityAt: ts(event),
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
}

function addMetricUsd(current: bigint | undefined, delta: bigint | null | undefined) {
  if (delta === undefined) return current;
  if (delta === null) return undefined;
  return current === undefined ? undefined : current + delta;
}

async function canonicalAccountMetric(
  context: any,
  event: BlockEvent,
  rawAccount: string,
  delta: AccountMetricDelta,
  countTransaction = true,
) {
  const accountAddress = await canonicalAccount(context, event, rawAccount);
  const id = `${event.chainId}:${accountAddress}`;
  const current = await ensureAccountMetric(context, event, accountAddress);
  const spendUsd = addMetricUsd(current.lifetimeSpentUsd, delta.spendUsd);
  const cashbackReceivedUsd = addMetricUsd(current.lifetimeCashbackReceivedUsd, delta.cashbackReceivedUsd);
  const borrowedUsd = addMetricUsd(current.borrowedUsd, delta.borrowedUsd);
  const repaidUsd = addMetricUsd(current.repaidUsd, delta.repaidUsd);
  const outstandingDebtUsd = borrowedUsd === undefined || repaidUsd === undefined ? undefined : borrowedUsd - repaidUsd;
  const next = {
    ...current,
    spendUsd: addMetricUsd(current.spendUsd, delta.spendUsd) ?? current.spendUsd,
    topUpCount: current.topUpCount + (delta.topUpCount ?? 0n),
    cashbackReceivedUsd:
      addMetricUsd(current.cashbackReceivedUsd, delta.cashbackReceivedUsd) ?? current.cashbackReceivedUsd,
    transactionCount: current.transactionCount + (countTransaction ? 1n : 0n),
    lifetimeDepositedUsd: addMetricUsd(current.lifetimeDepositedUsd, delta.depositedUsd),
    lifetimeSpentUsd: spendUsd,
    lifetimeWithdrawnUsd: addMetricUsd(current.lifetimeWithdrawnUsd, delta.withdrawnUsd),
    lifetimeCashbackUsd: cashbackReceivedUsd,
    lifetimeCashbackReceivedUsd: cashbackReceivedUsd,
    lifetimeCashbackGeneratedUsd: addMetricUsd(current.lifetimeCashbackGeneratedUsd, delta.cashbackGeneratedUsd),
    lifetimeCashbackGeneratedForOthersUsd: addMetricUsd(
      current.lifetimeCashbackGeneratedForOthersUsd,
      delta.cashbackGeneratedForOthersUsd,
    ),
    lifetimeCashbackRegularUsd: addMetricUsd(current.lifetimeCashbackRegularUsd, delta.cashbackRegularUsd),
    lifetimeCashbackSpenderUsd: addMetricUsd(current.lifetimeCashbackSpenderUsd, delta.cashbackSpenderUsd),
    lifetimeCashbackPromotionUsd: addMetricUsd(current.lifetimeCashbackPromotionUsd, delta.cashbackPromotionUsd),
    lifetimeCashbackReferralUsd: addMetricUsd(current.lifetimeCashbackReferralUsd, delta.cashbackReferralUsd),
    lifetimeCashbackOtherUsd: addMetricUsd(current.lifetimeCashbackOtherUsd, delta.cashbackOtherUsd),
    creditSpendUsd: addMetricUsd(current.creditSpendUsd, delta.creditSpendUsd),
    debitSpendUsd: addMetricUsd(current.debitSpendUsd, delta.debitSpendUsd),
    borrowedUsd,
    repaidUsd,
    eventLedgerOutstandingDebtUsd: outstandingDebtUsd,
    debtStatus: delta.borrowedUsd !== undefined || delta.repaidUsd !== undefined ? "event_ledger" : current.debtStatus,
    netWorthUsd:
      current.currentBalanceUsd === undefined || outstandingDebtUsd === undefined
        ? undefined
        : current.currentBalanceUsd - outstandingDebtUsd,
    lastActivityAt: ts(event),
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  };
  context.AccountMetric.set(next);
  const dailyId = `${id}:${dayFromUnixSeconds(event.block.timestamp)}`;
  const daily = (await context.AccountDailyMetric.get(dailyId)) ?? {
    id: dailyId,
    chainId: event.chainId,
    accountIdentityId: accountAddress,
    accountAddress,
    day: dayFromUnixSeconds(event.block.timestamp),
    spendUsd: 0n,
    topUpCount: 0n,
    cashbackReceivedUsd: 0n,
    depositedUsd: 0n,
    spentUsd: 0n,
    creditSpendUsd: 0n,
    debitSpendUsd: 0n,
    withdrawnUsd: 0n,
    cashbackUsd: 0n,
    borrowedUsd: 0n,
    repaidUsd: 0n,
    closingBalanceStatus: "pending",
    transactionCount: 0n,
  };
  context.AccountDailyMetric.set({
    ...daily,
    spendUsd: addMetricUsd(daily.spendUsd, delta.spendUsd) ?? daily.spendUsd,
    topUpCount: daily.topUpCount + (delta.topUpCount ?? 0n),
    cashbackReceivedUsd:
      addMetricUsd(daily.cashbackReceivedUsd, delta.cashbackReceivedUsd) ?? daily.cashbackReceivedUsd,
    depositedUsd: addMetricUsd(daily.depositedUsd, delta.depositedUsd),
    spentUsd: addMetricUsd(daily.spentUsd, delta.spendUsd),
    creditSpendUsd: addMetricUsd(daily.creditSpendUsd, delta.creditSpendUsd),
    debitSpendUsd: addMetricUsd(daily.debitSpendUsd, delta.debitSpendUsd),
    withdrawnUsd: addMetricUsd(daily.withdrawnUsd, delta.withdrawnUsd),
    cashbackUsd: addMetricUsd(daily.cashbackUsd, delta.cashbackReceivedUsd),
    borrowedUsd: addMetricUsd(daily.borrowedUsd, delta.borrowedUsd),
    repaidUsd: addMetricUsd(daily.repaidUsd, delta.repaidUsd),
    transactionCount: daily.transactionCount + (countTransaction ? 1n : 0n),
  });
}

async function bumpTopUpRecipient(context: any, event: BlockEvent, recipientAddress: string) {
  const recipient = lower(recipientAddress);
  const id = accountId(event.chainId, recipient);
  const current = (await context.TopUpRecipientMetric.get(id)) ?? {
    id,
    chainId: event.chainId,
    recipient,
    topUpCount: 0n,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  };
  context.TopUpRecipientMetric.set({
    ...current,
    topUpCount: current.topUpCount + 1n,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
}

async function bumpCashbackReceiver(context: any, event: BlockEvent, recipientAddress: string, amountUsd: bigint) {
  const recipient = lower(recipientAddress);
  const id = accountId(event.chainId, recipient);
  const current = (await context.CashbackReceiverMetric.get(id)) ?? {
    id,
    chainId: event.chainId,
    recipient,
    rewardCount: 0n,
    amountUsd: 0n,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  };
  context.CashbackReceiverMetric.set({
    ...current,
    rewardCount: current.rewardCount + 1n,
    amountUsd: current.amountUsd + amountUsd,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
}

async function updatePendingCashback(
  context: any,
  event: BlockEvent,
  recipientAddress: string,
  tokenAddress: string,
  amountDelta: bigint,
  usdDelta: bigint,
) {
  const recipient = lower(recipientAddress);
  const token = lower(tokenAddress);
  const id = `${event.chainId}:${recipient}:${token}`;
  const current = (await context.PendingCashbackBalance.get(id)) ?? {
    id,
    chainId: event.chainId,
    recipient,
    tokenAddress: token,
    amount: 0n,
    amountUsd: 0n,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  };
  context.PendingCashbackBalance.set({
    ...current,
    amount: current.amount + amountDelta < 0n ? 0n : current.amount + amountDelta,
    amountUsd: current.amountUsd + usdDelta < 0n ? 0n : current.amountUsd + usdDelta,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
}

function configEvent(
  context: any,
  event: BlockEvent,
  configType: string,
  subject: string,
  value: unknown,
  arrayIndex = 0,
) {
  context.CashConfigEvent.set({
    id: `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${arrayIndex}`,
    chainId: event.chainId,
    configType,
    subject: lower(subject),
    value: JSON.stringify(value),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(event),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
    arrayIndex,
  });
}

indexer.onEvent({ contract: "TopUpDest", event: "TopUp" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const canonical = await canonicalAction(
    context,
    base,
    "topup",
    event.params.user,
    undefined,
    JSON.stringify({ sourceChainId: String(event.params.chainId) }),
  );
  const valuation = await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    event.params.user,
    event.params.token,
    0,
    "topup",
    "in",
    event.params.amount,
  );
  await canonicalAccountMetric(context, base, event.params.user, {
    topUpCount: 1n,
    depositedUsd: valuation.amountUsd ?? null,
  });
  context.TopUp.set({
    id: `${event.chainId}:${event.params.chainId}:${lower(event.params.txId)}`,
    chainId: event.chainId,
    sourceChainId: event.params.chainId,
    txId: lower(event.params.txId),
    sourceTransactionHash: lower(event.params.sourceTxHash),
    account: ZERO_ADDRESS,
    user: lower(event.params.user),
    tradingSafe: lower(event.params.user),
    tokenAddress: lower(event.params.token),
    amount: event.params.amount,
    status: "completed_destination",
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "topup_completed", {
      actor: lower(event.params.user),
      tokenAddress: lower(event.params.token),
      amount: event.params.amount,
      metadata: JSON.stringify({
        txId: event.params.txId,
        sourceTxHash: event.params.sourceTxHash,
        sourceChainId: String(event.params.chainId),
      }),
    }),
  );
  await bumpDestinationBalance(context, base, event.params.user, event.params.token, event.params.amount, 0n, {
    topUpCount: 1n,
    topUpAmount: event.params.amount,
  });
  await markTokenAnalytics(context, base, event.params.token, { hasTopUp: true, hasBalance: true });
  await Promise.all([
    bumpDaily(context, base, { topUpCount: 1n }),
    bumpTopUpRecipient(context, base, event.params.user),
  ]);
});

indexer.onEvent({ contract: "LegacyTopUpDest", event: "TopUp" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const canonical = await canonicalAction(context, base, "topup", event.params.userSafe);
  const valuation = await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    event.params.userSafe,
    event.params.token,
    0,
    "topup",
    "in",
    event.params.amount,
  );
  await canonicalAccountMetric(context, base, event.params.userSafe, {
    topUpCount: 1n,
    depositedUsd: valuation.amountUsd ?? null,
  });
  context.TopUp.set({
    id: `${event.chainId}:${event.params.chainId}:${lower(event.params.txId)}`,
    chainId: event.chainId,
    sourceChainId: event.params.chainId,
    txId: lower(event.params.txId),
    sourceTransactionHash: lower(event.params.txId),
    account: ZERO_ADDRESS,
    user: lower(event.params.userSafe),
    tradingSafe: lower(event.params.userSafe),
    tokenAddress: lower(event.params.token),
    amount: event.params.amount,
    status: "completed_destination_legacy",
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "topup_completed_legacy", {
      actor: lower(event.params.userSafe),
      tokenAddress: lower(event.params.token),
      amount: event.params.amount,
      metadata: JSON.stringify({ txId: event.params.txId, sourceChainId: String(event.params.chainId) }),
    }),
  );
  await bumpDestinationBalance(context, base, event.params.userSafe, event.params.token, event.params.amount, 0n, {
    topUpCount: 1n,
    topUpAmount: event.params.amount,
  });
  await markTokenAnalytics(context, base, event.params.token, { hasTopUp: true, hasBalance: true });
  await Promise.all([
    bumpDaily(context, base, { topUpCount: 1n }),
    bumpTopUpRecipient(context, base, event.params.userSafe),
  ]);
});

indexer.onEvent({ contract: "LegacyTopUpDest", event: "TopUpBatch" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  let validCount = 0n;
  for (let index = 0; index < event.params.txId.length; index += 1) {
    const sourceChainId = event.params.chainId[index];
    const txId = event.params.txId[index];
    const user = event.params.userSafe[index];
    const token = event.params.token[index];
    const amount = event.params.amount[index];
    if (
      sourceChainId === undefined ||
      txId === undefined ||
      user === undefined ||
      token === undefined ||
      amount === undefined
    )
      continue;
    validCount += 1n;
    const canonical = await canonicalAction(
      context,
      base,
      "topup",
      user,
      undefined,
      JSON.stringify({ sourceChainId: String(sourceChainId), batchIndex: index }),
      `:${index}`,
    );
    // A batch may contain different Safes, so each row gets an independent
    // account action/leg identity while retaining the source log index.
    const valuation = await canonicalTokenLeg(context, base, canonical.id, user, token, 0, "topup", "in", amount);
    await canonicalAccountMetric(context, base, user, {
      topUpCount: 1n,
      depositedUsd: valuation.amountUsd ?? null,
    });
    context.TopUp.set({
      id: `${event.chainId}:${sourceChainId}:${lower(txId)}`,
      chainId: event.chainId,
      sourceChainId,
      txId: lower(txId),
      sourceTransactionHash: lower(txId),
      account: ZERO_ADDRESS,
      user: lower(user),
      tradingSafe: lower(user),
      tokenAddress: lower(token),
      amount,
      status: "completed_destination_legacy_batch",
      blockNumber: asBigInt(event.block.number),
      timestamp: ts(base),
      transactionHash: lower(event.transaction.hash),
      logIndex: event.logIndex,
    });
    context.ProtocolEvent.set(
      protocolEvent(base, "topup_completed_legacy_batch", {
        id: `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${index}`,
        actor: lower(user),
        tokenAddress: lower(token),
        amount,
        metadata: JSON.stringify({ txId, sourceChainId: String(sourceChainId), batchIndex: index }),
      }),
    );
    await bumpDestinationBalance(context, base, user, token, amount, 0n, { topUpCount: 1n, topUpAmount: amount });
    await markTokenAnalytics(context, base, token, { hasTopUp: true, hasBalance: true });
    await bumpTopUpRecipient(context, base, user);
  }
  await bumpDaily(context, base, { topUpCount: validCount });
});

async function handleCurrentSpend(event: any, context: any) {
  const base = event as unknown as BlockEvent;
  const spendId = eventId(event.chainId, event.transaction.hash, event.logIndex);
  const singleToken = event.params.tokens.length === 1 ? lower(event.params.tokens[0]) : ZERO_ADDRESS;
  const singleAmount = event.params.amounts.length === 1 ? event.params.amounts[0] : 0n;
  const canonical = await canonicalAction(context, base, "spend", event.params.safe, event.params.totalUsdAmt);
  for (let index = 0; index < event.params.tokens.length; index += 1) {
    const token = event.params.tokens[index];
    const amount = event.params.amounts[index];
    const amountUsd = event.params.amountInUsd[index];
    if (token !== undefined && amount !== undefined)
      await canonicalTokenLeg(
        context,
        base,
        canonical.id,
        event.params.safe,
        token,
        index,
        "spend",
        "out",
        amount,
        amountUsd,
        Number(event.params.mode) === 0 ? "credit" : Number(event.params.mode) === 1 ? "debit" : undefined,
      );
  }
  await canonicalAccountMetric(context, base, event.params.safe, {
    spendUsd: event.params.totalUsdAmt,
    ...(Number(event.params.mode) === 0
      ? { creditSpendUsd: event.params.totalUsdAmt }
      : Number(event.params.mode) === 1
        ? { debitSpendUsd: event.params.totalUsdAmt }
        : {}),
  });
  context.Spend.set({
    id: spendId,
    chainId: event.chainId,
    safe: lower(event.params.safe),
    txId: lower(event.params.txId),
    sponsor: Number(event.params.binSponsor),
    tokens: JSON.stringify(event.params.tokens.map(lower)),
    amounts: jsonBigInts(event.params.amounts),
    amountsUsd: jsonBigInts(event.params.amountInUsd),
    totalUsd: event.params.totalUsdAmt,
    usdDecimals: 6,
    mode: Number(event.params.mode),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
    dataAvailability: "onchain_settled",
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "spend", {
      actor: lower(event.params.safe),
      tokenAddress: singleToken,
      amount: singleAmount,
      amountUsd: event.params.totalUsdAmt,
      metadata: JSON.stringify({
        txId: event.params.txId,
        tokenCount: event.params.tokens.length,
        tokens: event.params.tokens.map(lower),
        amounts: event.params.amounts.map(String),
        mode: Number(event.params.mode),
      }),
    }),
  );
  // Balance and spend-leg updates can target the same metric row. Sequence
  // them so Envio get/set writes cannot overwrite a sibling delta.
  await debitSpendBalances(context, base, event.params.safe, event.params.tokens, event.params.amounts);
  await recordSpendTokenValuations(
    context,
    base,
    spendId,
    event.params.tokens,
    event.params.amounts,
    event.params.amountInUsd,
  );
  await recordSpendMetrics(context, base, event.params.safe, event.params.totalUsdAmt, Number(event.params.mode));
}

indexer.onEvent({ contract: "CashEventEmitter", event: "Spend" }, async ({ event, context }) => {
  await handleCurrentSpend(event, context);
});

async function handleRepayment(event: any, context: any, repaymentType: string) {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const token = lower(event.params.token);
  const canonical = await canonicalAction(context, base, "repay", safe, event.params.debtAmountInUsd);
  await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    safe,
    token,
    0,
    "repay",
    "out",
    event.params.debtAmount,
    event.params.debtAmountInUsd,
    undefined,
    { affectsSafeBalance: false },
  );
  await canonicalAccountMetric(context, base, safe, { repaidUsd: event.params.debtAmountInUsd });
  context.Repayment.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    safe,
    tokenAddress: token,
    amount: event.params.debtAmount,
    amountUsd: event.params.debtAmountInUsd,
    repaymentType,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, repaymentType, {
      actor: safe,
      tokenAddress: token,
      amount: event.params.debtAmount,
      amountUsd: event.params.debtAmountInUsd,
    }),
  );
  await markTokenAnalytics(context, base, token, { hasRepayment: true });
  await updateTokenAnalytics(context, base, token, {
    repaidCount: 1n,
    repaidAmount: event.params.debtAmount,
    repaidUsd: event.params.debtAmountInUsd,
  });
  await bumpDaily(context, base, { repaidUsd: event.params.debtAmountInUsd });
}

indexer.onEvent({ contract: "CashEventEmitter", event: "RepayDebtManager" }, async ({ event, context }) => {
  await handleRepayment(event, context, "repay_debt_manager");
});

indexer.onEvent({ contract: "CashEventEmitter", event: "Repay" }, async ({ event, context }) => {
  await handleRepayment(event, context, "repay");
});

indexer.onEvent({ contract: "CashEventEmitter", event: "RepayLendTokenAmount" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const token = lower(event.params.token);
  const canonical = await canonicalAction(context, base, "repayment", safe);
  await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    safe,
    token,
    0,
    "repay",
    "out",
    event.params.debtAmount,
    undefined,
    undefined,
    { affectsSafeBalance: false },
  );
  await canonicalAccountMetric(context, base, safe, { repaidUsd: null });
  context.DebtEvent.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    debtManager: lower(event.srcAddress),
    managerVersion: "cash_lend",
    eventType: "repay_lend_token_amount",
    user: safe,
    payer: safe,
    tokenAddress: token,
    amount: event.params.debtAmount,
    amountUsd: 0n,
    usdStatus: "unpriced_event_only",
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "repay_lend_token_amount", {
      actor: safe,
      tokenAddress: token,
      amount: event.params.debtAmount,
      metadata: JSON.stringify({ usdStatus: "unpriced_event_only" }),
    }),
  );
  await markTokenAnalytics(context, base, token, { hasDebt: true });
  await updateTokenAnalytics(context, base, token, { repaidCount: 1n, repaidAmount: event.params.debtAmount });
});

indexer.onEvent({ contract: "CashEventEmitter", event: "LendBorrowed" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const token = lower(event.params.token);
  const canonical = await canonicalAction(context, base, "borrow", safe, event.params.amountInUsd);
  await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    safe,
    token,
    0,
    "borrow",
    "in",
    event.params.amount,
    event.params.amountInUsd,
    "credit",
    { affectsSafeBalance: false },
  );
  await canonicalAccountMetric(context, base, safe, { borrowedUsd: event.params.amountInUsd });
  context.DebtEvent.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    debtManager: lower(event.srcAddress),
    managerVersion: "cash_lend",
    eventType: "lend_borrowed",
    user: safe,
    payer: ZERO_ADDRESS,
    tokenAddress: token,
    amount: event.params.amount,
    amountUsd: event.params.amountInUsd,
    usdStatus: "event_priced_volume",
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "lend_borrowed", {
      actor: safe,
      tokenAddress: token,
      amount: event.params.amount,
      amountUsd: event.params.amountInUsd,
    }),
  );
  await markTokenAnalytics(context, base, token, { hasDebt: true });
  await updateTokenAnalytics(context, base, token, {
    borrowedCount: 1n,
    borrowedAmount: event.params.amount,
    borrowedUsd: event.params.amountInUsd,
  });
  await bumpDaily(context, base, { borrowedUsd: event.params.amountInUsd });
});

indexer.onEvent({ contract: "CashEventEmitter", event: "Cashback" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const recipient = lower(event.params.recipient);
  const token = lower(event.params.cashbackToken);
  const cashbackType = Number(event.params.cashbackType);
  const typeDelta =
    cashbackType === 0
      ? { cashbackRegularUsd: event.params.cashbackInUsd }
      : cashbackType === 1
        ? { cashbackSpenderUsd: event.params.cashbackInUsd }
        : cashbackType === 2
          ? { cashbackPromotionUsd: event.params.cashbackInUsd }
          : cashbackType === 3
            ? { cashbackReferralUsd: event.params.cashbackInUsd }
            : { cashbackOtherUsd: event.params.cashbackInUsd };
  const canonical = await canonicalAction(
    context,
    base,
    event.params.paid ? "cashback_received" : "cashback_generated",
    safe,
    event.params.cashbackInUsd,
    JSON.stringify({ recipient, cashbackType: String(event.params.cashbackType), paid: event.params.paid }),
  );
  // Generated cashback is not a balance credit; only the paid settlement is.
  if (event.params.paid) {
    await canonicalTokenLeg(
      context,
      base,
      canonical.id,
      recipient,
      token,
      0,
      "cashback_received",
      "in",
      event.params.cashbackAmountInToken,
      event.params.cashbackInUsd,
      undefined,
      { cashbackType: String(cashbackType) },
    );
  }
  if (recipient === safe) {
    await canonicalAccountMetric(context, base, safe, {
      cashbackGeneratedUsd: event.params.cashbackInUsd,
      ...(event.params.paid ? { cashbackReceivedUsd: event.params.cashbackInUsd } : {}),
      ...typeDelta,
    });
  } else {
    await canonicalAccountMetric(context, base, safe, {
      cashbackGeneratedUsd: event.params.cashbackInUsd,
      cashbackGeneratedForOthersUsd: event.params.cashbackInUsd,
      ...typeDelta,
    });
    if (event.params.paid)
      await canonicalAccountMetric(context, base, recipient, { cashbackReceivedUsd: event.params.cashbackInUsd });
  }
  context.Cashback.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    safe,
    recipient,
    spendingUsd: event.params.spendingInUsd,
    tokenAddress: token,
    amount: event.params.cashbackAmountInToken,
    amountUsd: event.params.cashbackInUsd,
    cashbackType: event.params.cashbackType,
    paid: event.params.paid,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "cashback", {
      actor: safe,
      tokenAddress: token,
      amount: event.params.cashbackAmountInToken,
      amountUsd: event.params.cashbackInUsd,
      metadata: JSON.stringify({
        recipient,
        spendingInUsd: String(event.params.spendingInUsd),
        cashbackType: String(event.params.cashbackType),
        paid: event.params.paid,
      }),
    }),
  );
  await Promise.all([
    recordToken(context, base, token),
    bumpDaily(context, base, { cashbackUsd: event.params.cashbackInUsd }),
    ...(event.params.paid
      ? [bumpCashbackReceiver(context, base, recipient, event.params.cashbackInUsd)]
      : [
          updatePendingCashback(
            context,
            base,
            recipient,
            token,
            event.params.cashbackAmountInToken,
            event.params.cashbackInUsd,
          ),
        ]),
  ]);
});

indexer.onEvent({ contract: "CashEventEmitter", event: "PendingCashbackCleared" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const recipient = lower(event.params.recipient);
  const token = lower(event.params.cashbackToken);
  const canonical = await canonicalAction(
    context,
    base,
    "cashback_received",
    recipient,
    event.params.cashbackInUsd,
    JSON.stringify({ settlementOfPending: true }),
  );
  await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    recipient,
    token,
    0,
    "cashback_received",
    "in",
    event.params.cashbackAmount,
    event.params.cashbackInUsd,
  );
  await canonicalAccountMetric(context, base, recipient, { cashbackReceivedUsd: event.params.cashbackInUsd });
  // Kept separate from Cashback totals because this can settle a previously
  // emitted pending reward; adding both would double-count the reward value.
  context.ProtocolEvent.set(
    protocolEvent(base, "pending_cashback_cleared", {
      actor: recipient,
      tokenAddress: token,
      amount: event.params.cashbackAmount,
      amountUsd: event.params.cashbackInUsd,
    }),
  );
  await Promise.all([
    recordToken(context, base, token),
    updatePendingCashback(context, base, recipient, token, -event.params.cashbackAmount, -event.params.cashbackInUsd),
    bumpCashbackReceiver(context, base, recipient, event.params.cashbackInUsd),
  ]);
});

async function handleWithdrawal(event: any, context: any, status: string) {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const recipient = lower(event.params.recipient);
  const tokens = event.params.tokens.map(lower);
  const amounts = event.params.amounts;
  const finalizeTimestamp = event.params.finalizeTimestamp ?? 0n;
  const canonical = await canonicalAction(
    context,
    base,
    `withdrawal_${status}`,
    safe,
    undefined,
    JSON.stringify({ recipient, finalizeTimestamp: String(finalizeTimestamp) }),
  );
  let withdrawalUsd = 0n;
  let allPriced = true;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const amount = amounts[index];
    if (token === undefined || amount === undefined) continue;
    const financial = status === "processed";
    const valuation = await canonicalTokenLeg(
      context,
      base,
      canonical.id,
      safe,
      token,
      index,
      "withdrawal",
      status === "cancelled" ? "neutral" : "out",
      amount,
      undefined,
      undefined,
      {
        status: status === "requested" ? "pending" : status === "cancelled" ? "cancelled" : "completed",
        affectsSafeBalance: financial,
      },
    );
    if (financial) {
      if (valuation.amountUsd === undefined) allPriced = false;
      else withdrawalUsd += valuation.amountUsd;
    }
  }
  await canonicalAccountMetric(context, base, safe, {
    ...(status === "processed" ? { withdrawnUsd: allPriced ? withdrawalUsd : null } : {}),
  });
  context.WithdrawalEvent.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    safe,
    recipient,
    tokens: JSON.stringify(tokens),
    amounts: jsonBigInts(amounts),
    status,
    finalizeTimestamp,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, `withdrawal_${status}`, {
      actor: safe,
      metadata: JSON.stringify({
        recipient,
        tokens,
        amounts: amounts.map(String),
        ...(status === "requested" ? { finalizeTimestamp: String(finalizeTimestamp) } : {}),
      }),
    }),
  );
  for (const token of uniqueLowercase(tokens)) {
    await recordToken(context, base, token);
    if (status === "requested") await updateTokenAnalytics(context, base, token, { withdrawalCount: 1n });
  }
  const stateId = accountId(event.chainId, safe);
  const previous = await context.PendingWithdrawalState.get(stateId);
  context.PendingWithdrawalState.set({
    ...(previous ?? { id: stateId, chainId: event.chainId, safe }),
    recipient,
    tokens: JSON.stringify(tokens),
    amounts: jsonBigInts(amounts),
    status,
    finalizeTimestamp,
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
}

indexer.onEvent({ contract: "CashEventEmitter", event: "WithdrawalRequested" }, async ({ event, context }) => {
  await handleWithdrawal(event, context, "requested");
});

indexer.onEvent({ contract: "CashEventEmitter", event: "WithdrawalCancelled" }, async ({ event, context }) => {
  await handleWithdrawal(event, context, "cancelled");
});

indexer.onEvent({ contract: "CashEventEmitter", event: "WithdrawalProcessed" }, async ({ event, context }) => {
  await handleWithdrawal(event, context, "processed");
});

cashIndexer.onEvent({ contract: "CashEventEmitter", event: "WithdrawalAmountUpdated" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const token = lower(event.params.token);
  const canonical = await canonicalAction(context, base, "withdrawal_amount_updated", safe);
  await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    safe,
    token,
    0,
    "withdrawal",
    "neutral",
    event.params.amount,
    undefined,
    undefined,
    { status: "pending", affectsSafeBalance: false },
  );
  await canonicalAccountMetric(context, base, safe, {});
  const id = accountId(event.chainId, safe);
  const current = await context.PendingWithdrawalState.get(id);
  const tokens: string[] = current ? JSON.parse(current.tokens) : [];
  const amounts: string[] = current ? JSON.parse(current.amounts) : [];
  const index = tokens.indexOf(token);
  if (index >= 0) amounts[index] = event.params.amount.toString();
  else {
    tokens.push(token);
    amounts.push(event.params.amount.toString());
  }
  context.PendingWithdrawalState.set({
    ...(current ?? {
      id,
      chainId: event.chainId,
      safe,
      recipient: ZERO_ADDRESS,
      tokens: "[]",
      amounts: "[]",
      status: "requested",
      finalizeTimestamp: 0n,
    }),
    tokens: JSON.stringify(tokens),
    amounts: JSON.stringify(amounts),
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
  context.WithdrawalEvent.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    safe,
    recipient: current?.recipient ?? ZERO_ADDRESS,
    tokens: JSON.stringify(tokens),
    amounts: JSON.stringify(amounts),
    status: "amount_updated",
    finalizeTimestamp: current?.finalizeTimestamp ?? 0n,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "withdrawal_amount_updated", { actor: safe, tokenAddress: token, amount: event.params.amount }),
  );
  await recordToken(context, base, token);
});

for (const [eventName, status] of [
  ["LendOptOutRequested", "opt_out_requested"],
  ["LendOptOutExecuted", "opt_out_executed"],
  ["LendOptedIn", "opted_in"],
] as const) {
  cashIndexer.onEvent({ contract: "CashEventEmitter", event: eventName }, async ({ event, context }: any) => {
    const base = event as unknown as BlockEvent;
    const safe = lower(event.params.safe);
    const finalizeTime = eventName === "LendOptOutRequested" ? event.params.finalizeTime : 0n;
    context.SafeLendEvent.set({
      id: eventId(event.chainId, event.transaction.hash, event.logIndex),
      chainId: event.chainId,
      safe,
      eventType: status,
      finalizeTime,
      blockNumber: asBigInt(event.block.number),
      timestamp: ts(base),
      transactionHash: lower(event.transaction.hash),
      logIndex: event.logIndex,
    });
    context.SafeLendState.set({
      id: accountId(event.chainId, safe),
      chainId: event.chainId,
      safe,
      status,
      finalizeTime,
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    });
    context.ProtocolEvent.set(
      protocolEvent(base, status, { actor: safe, metadata: JSON.stringify({ finalizeTime: String(finalizeTime) }) }),
    );
  });
}

function limitFields(limit: any) {
  return {
    dailyLimit: limit.dailyLimit,
    monthlyLimit: limit.monthlyLimit,
    spentToday: limit.spentToday,
    spentThisMonth: limit.spentThisMonth,
    newDailyLimit: limit.newDailyLimit,
    newMonthlyLimit: limit.newMonthlyLimit,
    dailyRenewalTimestamp: BigInt(limit.dailyRenewalTimestamp),
    monthlyRenewalTimestamp: BigInt(limit.monthlyRenewalTimestamp),
    dailyLimitChangeActivationTime: BigInt(limit.dailyLimitChangeActivationTime),
    monthlyLimitChangeActivationTime: BigInt(limit.monthlyLimitChangeActivationTime),
    timezoneOffset: BigInt(limit.timezoneOffset),
  };
}
cashIndexer.onEvent({ contract: "CashEventEmitter", event: "SpendingLimitChanged" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const oldLimit = limitFields(event.params.oldLimit);
  const newLimit = limitFields(event.params.newLimit);
  const id = eventId(event.chainId, event.transaction.hash, event.logIndex);
  context.SafeSpendingLimitState.set({
    id: accountId(event.chainId, safe),
    chainId: event.chainId,
    safe,
    ...newLimit,
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
  context.SafeSpendingLimitChange.set({
    id,
    chainId: event.chainId,
    safe,
    oldDailyLimit: oldLimit.dailyLimit,
    oldMonthlyLimit: oldLimit.monthlyLimit,
    oldSpentToday: oldLimit.spentToday,
    oldSpentThisMonth: oldLimit.spentThisMonth,
    oldNewDailyLimit: oldLimit.newDailyLimit,
    oldNewMonthlyLimit: oldLimit.newMonthlyLimit,
    oldDailyRenewalTimestamp: oldLimit.dailyRenewalTimestamp,
    oldMonthlyRenewalTimestamp: oldLimit.monthlyRenewalTimestamp,
    oldDailyLimitChangeActivationTime: oldLimit.dailyLimitChangeActivationTime,
    oldMonthlyLimitChangeActivationTime: oldLimit.monthlyLimitChangeActivationTime,
    oldTimezoneOffset: oldLimit.timezoneOffset,
    newDailyLimit: newLimit.dailyLimit,
    newMonthlyLimit: newLimit.monthlyLimit,
    newSpentToday: newLimit.spentToday,
    newSpentThisMonth: newLimit.spentThisMonth,
    newNewDailyLimit: newLimit.newDailyLimit,
    newNewMonthlyLimit: newLimit.newMonthlyLimit,
    newDailyRenewalTimestamp: newLimit.dailyRenewalTimestamp,
    newMonthlyRenewalTimestamp: newLimit.monthlyRenewalTimestamp,
    newDailyLimitChangeActivationTime: newLimit.dailyLimitChangeActivationTime,
    newMonthlyLimitChangeActivationTime: newLimit.monthlyLimitChangeActivationTime,
    newTimezoneOffset: newLimit.timezoneOffset,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "spending_limit_changed", {
      actor: safe,
      metadata: JSON.stringify({ oldLimit, newLimit }, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    }),
  );
});

cashIndexer.onEvent({ contract: "CashEventEmitter", event: "ModeSet" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const safe = lower(event.params.safe);
  const previousModeId = Number(event.params.prevMode);
  const modeId = Number(event.params.newMode);
  const activationTime = event.params.incomingModeStartTime;
  context.SafeModeState.set({
    id: accountId(event.chainId, safe),
    chainId: event.chainId,
    safe,
    currentModeId: previousModeId,
    pendingModeId: modeId,
    activationTime,
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
  context.SafeModeChange.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    safe,
    previousModeId,
    modeId,
    activationTime,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "mode_set", {
      actor: safe,
      metadata: JSON.stringify({ previousModeId, modeId, activationTime: String(activationTime) }),
    }),
  );
});

for (const [eventName, entity, eventType] of [
  ["CollateralResupplied", "CollateralResupply", "collateral_resupplied"],
  ["LendSupplyFailed", "LendSupplyFailure", "lend_supply_failed"],
] as const) {
  cashIndexer.onEvent({ contract: "CashEventEmitter", event: eventName }, async ({ event, context }: any) => {
    const base = event as unknown as BlockEvent;
    const safe = lower(event.params.safe);
    const tokenAddress = lower(event.params.token);
    const id = eventId(event.chainId, event.transaction.hash, event.logIndex);
    context[entity].set({
      id,
      chainId: event.chainId,
      safe,
      tokenAddress,
      amount: event.params.amount,
      ...(eventName === "LendSupplyFailed" ? { reason: lower(event.params.reason) } : {}),
      blockNumber: asBigInt(event.block.number),
      timestamp: ts(base),
      transactionHash: lower(event.transaction.hash),
      logIndex: event.logIndex,
    });
    context.ProtocolEvent.set(
      protocolEvent(base, eventType, {
        actor: safe,
        tokenAddress,
        amount: event.params.amount,
        metadata: eventName === "LendSupplyFailed" ? JSON.stringify({ reason: lower(event.params.reason) }) : "{}",
      }),
    );
    await recordToken(context, base, tokenAddress);
  });
}

async function bumpTierMetric(context: any, event: BlockEvent, tierId: number, entries: bigint, exits: bigint) {
  const day = dayFromUnixSeconds(event.block.timestamp);
  const id = `${event.chainId}:${day}:${tierId}`;
  const current = (await context.TierDailyMetric.get(id)) ?? {
    id,
    chainId: event.chainId,
    day,
    tierId,
    entries: 0n,
    exits: 0n,
    netChange: 0n,
    transitionCount: 0n,
  };
  context.TierDailyMetric.set({
    ...current,
    entries: current.entries + entries,
    exits: current.exits + exits,
    netChange: current.netChange + entries - exits,
    transitionCount: current.transitionCount + 1n,
  });
}
cashIndexer.onEvent({ contract: "CashEventEmitter", event: "SafeTiersSet" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  for (let arrayIndex = 0; arrayIndex < event.params.safes.length; arrayIndex += 1) {
    const rawSafe = event.params.safes[arrayIndex];
    const rawTier = event.params.tiers[arrayIndex];
    if (rawSafe === undefined || rawTier === undefined) continue;
    const safe = lower(rawSafe);
    const tierId = Number(rawTier);
    const stateId = accountId(event.chainId, safe);
    const previous = await context.SafeTierState.get(stateId);
    const previousTierId = previous?.tierId;
    context.SafeTierState.set({
      id: stateId,
      chainId: event.chainId,
      safe,
      tierId,
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    });
    const accountMetric = await ensureAccountMetric(context, base, safe);
    context.AccountMetric.set({
      ...accountMetric,
      currentTierId: tierId,
      tierUpdatedAt: ts(base),
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    });
    context.SafeTierChange.set({
      id: `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${arrayIndex}`,
      chainId: event.chainId,
      safe,
      previousTierId,
      tierId,
      blockNumber: asBigInt(event.block.number),
      timestamp: ts(base),
      transactionHash: lower(event.transaction.hash),
      logIndex: event.logIndex,
      arrayIndex,
    });
    context.ProtocolEvent.set(
      protocolEvent(base, "safe_tier_set", {
        id: `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${arrayIndex}`,
        actor: safe,
        metadata: JSON.stringify({ previousTierId, tierId, arrayIndex }),
      }),
    );
    await bumpTierMetric(context, base, tierId, previousTierId === tierId ? 0n : 1n, 0n);
    if (previousTierId !== undefined && previousTierId !== tierId)
      await bumpTierMetric(context, base, previousTierId, 0n, 1n);
  }
});
cashIndexer.onEvent(
  { contract: "CashEventEmitter", event: "TierCashbackPercentageSet" },
  async ({ event, context }) => {
    const base = event as unknown as BlockEvent;
    for (let arrayIndex = 0; arrayIndex < event.params.tiers.length; arrayIndex += 1) {
      const rawTier = event.params.tiers[arrayIndex];
      const percentage = event.params.cashbackPercentages[arrayIndex];
      if (rawTier === undefined || percentage === undefined) continue;
      const tierId = Number(rawTier);
      const id = `${event.chainId}:${tierId}`;
      context.TierCashbackPercentage.set({
        id,
        chainId: event.chainId,
        tierId,
        percentage,
        updatedAt: ts(base),
        updatedBlock: asBigInt(event.block.number),
      });
      configEvent(
        context,
        base,
        "tier_cashback_percentage",
        String(tierId),
        { tierId, percentage: String(percentage) },
        arrayIndex,
      );
      context.ProtocolEvent.set(
        protocolEvent(base, "tier_cashback_percentage_set", {
          id: `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${arrayIndex}`,
          metadata: JSON.stringify({ tierId, percentage: String(percentage), arrayIndex }),
        }),
      );
    }
  },
);
cashIndexer.onEvent(
  { contract: "CashEventEmitter", event: "CashbackSplitToSafeBpsSet" },
  async ({ event, context }) => {
    const base = event as unknown as BlockEvent;
    const safe = lower(event.params.safe);
    context.SafeCashbackSplit.set({
      id: accountId(event.chainId, safe),
      chainId: event.chainId,
      safe,
      splitInBps: event.params.newSplitInBps,
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    });
    configEvent(context, base, "cashback_split", safe, {
      oldSplitInBps: String(event.params.oldSplitInBps),
      newSplitInBps: String(event.params.newSplitInBps),
    });
    context.ProtocolEvent.set(
      protocolEvent(base, "cashback_split_set", { actor: safe, amount: event.params.newSplitInBps }),
    );
  },
);
cashIndexer.onEvent({ contract: "CashEventEmitter", event: "DelaysSet" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  context.CashDelaysState.set({
    id: String(event.chainId),
    chainId: event.chainId,
    withdrawalDelay: BigInt(event.params.withdrawalDelay),
    spendingLimitDelay: BigInt(event.params.spendingLimitDelay),
    modeDelay: BigInt(event.params.modeDelay),
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
  configEvent(context, base, "delays", ZERO_ADDRESS, {
    withdrawalDelay: String(event.params.withdrawalDelay),
    spendingLimitDelay: String(event.params.spendingLimitDelay),
    modeDelay: String(event.params.modeDelay),
  });
  context.ProtocolEvent.set(protocolEvent(base, "delays_set"));
});
cashIndexer.onEvent(
  { contract: "CashEventEmitter", event: "SettlementDispatcheUpdated" },
  async ({ event, context }) => {
    const base = event as unknown as BlockEvent;
    const binSponsorId = Number(event.params.binSponsor);
    context.SettlementDispatcherState.set({
      id: `${event.chainId}:${binSponsorId}`,
      chainId: event.chainId,
      binSponsorId,
      dispatcher: lower(event.params.newDispatcher),
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    });
    configEvent(context, base, "settlement_dispatcher", String(binSponsorId), {
      oldDispatcher: lower(event.params.oldDispatcher),
      newDispatcher: lower(event.params.newDispatcher),
    });
    context.ProtocolEvent.set(
      protocolEvent(base, "settlement_dispatcher_updated", {
        actor: lower(event.params.newDispatcher),
        metadata: JSON.stringify({ binSponsorId, oldDispatcher: lower(event.params.oldDispatcher) }),
      }),
    );
  },
);
cashIndexer.onEvent({ contract: "CashEventEmitter", event: "LendGatewaySet" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const gateway = lower(event.params.gateway);
  context.LendGatewayState.set({
    id: String(event.chainId),
    chainId: event.chainId,
    gateway,
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
  configEvent(context, base, "lend_gateway", gateway, { gateway });
  context.ProtocolEvent.set(protocolEvent(base, "lend_gateway_set", { actor: gateway }));
});
for (const [eventName, entity, field, configType] of [
  ["WithdrawTokensConfigured", "WithdrawalTokenWhitelist", "tokenAddress", "withdrawal_token"],
  ["ModulesCanRequestWithdrawConfigured", "WithdrawalModuleWhitelist", "moduleAddress", "withdrawal_module"],
] as const) {
  cashIndexer.onEvent({ contract: "CashEventEmitter", event: eventName }, async ({ event, context }: any) => {
    const base = event as unknown as BlockEvent;
    const isWithdrawalToken = eventName === "WithdrawTokensConfigured";
    const subjects = isWithdrawalToken ? event.params.tokens : event.params.modules;
    for (let arrayIndex = 0; arrayIndex < subjects.length; arrayIndex += 1) {
      const subject = subjects[arrayIndex];
      const whitelisted = event.params.shouldWhitelist[arrayIndex];
      if (subject === undefined || whitelisted === undefined) continue;
      const address = lower(subject);
      context[entity].set({
        id: `${event.chainId}:${address}`,
        chainId: event.chainId,
        [field]: address,
        whitelisted,
        updatedAt: ts(base),
        updatedBlock: asBigInt(event.block.number),
      });
      configEvent(context, base, configType, address, { whitelisted }, arrayIndex);
      context.ProtocolEvent.set(
        protocolEvent(base, `${configType}_configured`, {
          id: `${eventId(event.chainId, event.transaction.hash, event.logIndex)}:${arrayIndex}`,
          actor: isWithdrawalToken ? ZERO_ADDRESS : address,
          tokenAddress: isWithdrawalToken ? address : ZERO_ADDRESS,
          metadata: JSON.stringify({
            whitelisted,
            arrayIndex,
            [isWithdrawalToken ? "tokenAddress" : "moduleAddress"]: address,
          }),
        }),
      );
      if (isWithdrawalToken) await recordToken(context, base, address);
    }
  });
}

indexer.onEvent({ contract: "ScrollCashEmitter", event: "CurrentSpend" }, async ({ event, context }) => {
  await handleCurrentSpend(event, context);
});

indexer.onEvent({ contract: "ScrollCashEmitter", event: "LegacySpend" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const spendId = eventId(event.chainId, event.transaction.hash, event.logIndex);
  const fundingMode =
    Number(event.params.mode) === 0 ? "credit" : Number(event.params.mode) === 1 ? "debit" : undefined;
  const canonical = await canonicalAction(context, base, "spend", event.params.userSafe, event.params.amountInUsd);
  await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    event.params.userSafe,
    event.params.token,
    0,
    "spend",
    "out",
    event.params.amount,
    event.params.amountInUsd,
    fundingMode,
  );
  await canonicalAccountMetric(context, base, event.params.userSafe, {
    spendUsd: event.params.amountInUsd,
    ...(fundingMode === "credit"
      ? { creditSpendUsd: event.params.amountInUsd }
      : fundingMode === "debit"
        ? { debitSpendUsd: event.params.amountInUsd }
        : {}),
  });
  context.Spend.set({
    id: spendId,
    chainId: event.chainId,
    safe: lower(event.params.userSafe),
    txId: lower(event.transaction.hash),
    sponsor: 0,
    tokens: JSON.stringify([lower(event.params.token)]),
    amounts: jsonBigInts([event.params.amount]),
    amountsUsd: jsonBigInts([event.params.amountInUsd]),
    totalUsd: event.params.amountInUsd,
    usdDecimals: 6,
    mode: Number(event.params.mode),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
    dataAvailability: "onchain_settled_legacy",
  });
  context.ProtocolEvent.set(
    protocolEvent(base, "spend_legacy", {
      actor: lower(event.params.userSafe),
      tokenAddress: lower(event.params.token),
      amount: event.params.amount,
      amountUsd: event.params.amountInUsd,
      metadata: JSON.stringify({ mode: Number(event.params.mode), legacy: true }),
    }),
  );
  await bumpDestinationBalance(context, base, event.params.userSafe, event.params.token, 0n, event.params.amount);
  await recordSpendTokenValuations(
    context,
    base,
    spendId,
    [event.params.token],
    [event.params.amount],
    [event.params.amountInUsd],
  );
  await recordSpendMetrics(context, base, event.params.userSafe, event.params.amountInUsd, Number(event.params.mode));
});

async function recordDebtEvent(
  event: any,
  context: any,
  managerVersion: string,
  eventType: "supplied" | "borrowed" | "repaid",
) {
  const base = event as unknown as BlockEvent;
  const user = lower(event.params.user);
  const token = lower(event.params.token);
  const debtManager = lower(event.srcAddress);
  const payer = eventType === "repaid" ? lower(event.params.payer) : ZERO_ADDRESS;
  const amount = event.params.amount;
  const id = eventId(event.chainId, event.transaction.hash, event.logIndex);
  const canonical = await canonicalAction(context, base, `debt_${eventType}`, user);
  const valuation = await canonicalTokenLeg(
    context,
    base,
    canonical.id,
    user,
    token,
    0,
    eventType === "borrowed" ? "borrow" : eventType === "repaid" ? "repay" : "supplied",
    eventType === "borrowed" ? "in" : eventType === "repaid" ? "out" : "neutral",
    amount,
    undefined,
    eventType === "borrowed" ? "credit" : undefined,
    { affectsSafeBalance: false },
  );
  await canonicalAccountMetric(
    context,
    base,
    user,
    eventType === "borrowed"
      ? { borrowedUsd: valuation.amountUsd ?? null }
      : eventType === "repaid"
        ? { repaidUsd: valuation.amountUsd ?? null }
        : {},
  );
  context.DebtEvent.set({
    id,
    chainId: event.chainId,
    debtManager,
    managerVersion,
    eventType,
    user,
    payer,
    tokenAddress: token,
    amount,
    amountUsd: valuation.amountUsd,
    usdStatus: valuation.status,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  if (eventType === "supplied") {
    context.ProtocolEvent.set(protocolEvent(base, "debt_supplied", { actor: user, tokenAddress: token, amount }));
    await markTokenAnalytics(context, base, token, { hasDebt: true });
    await updateTokenAnalytics(context, base, token, { suppliedCount: 1n, suppliedAmount: amount });
    return;
  }

  const positionId = `${event.chainId}:${debtManager}:${user}:${token}`;
  const current = (await context.DebtPosition.get(positionId)) ?? {
    id: positionId,
    chainId: event.chainId,
    debtManager,
    user,
    tokenAddress: token,
    borrowedAmount: 0n,
    repaidAmount: 0n,
    liquidatedAmount: 0n,
    outstandingAmount: 0n,
    borrowedUsd: 0n,
    repaidUsd: 0n,
    liquidatedUsd: 0n,
    outstandingUsd: 0n,
    usdStatus: "event_ledger_empty",
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  };
  const borrowedAmount = current.borrowedAmount + (eventType === "borrowed" ? amount : 0n);
  const repaidAmount = current.repaidAmount + (eventType === "repaid" ? amount : 0n);
  const borrowedUsd = current.borrowedUsd + (eventType === "borrowed" ? (valuation.amountUsd ?? 0n) : 0n);
  const repaidUsd = current.repaidUsd + (eventType === "repaid" ? (valuation.amountUsd ?? 0n) : 0n);
  const usdStatus =
    valuation.amountUsd === undefined || ["unpriced_event_only", "event_ledger_partial"].includes(current.usdStatus)
      ? "event_ledger_partial"
      : "event_ledger_priced";
  context.DebtPosition.set({
    ...current,
    borrowedAmount,
    repaidAmount,
    outstandingAmount: borrowedAmount - repaidAmount - current.liquidatedAmount,
    borrowedUsd,
    repaidUsd,
    outstandingUsd: borrowedUsd - repaidUsd - current.liquidatedUsd,
    usdStatus,
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
  context.ProtocolEvent.set(
    protocolEvent(base, `debt_${eventType}`, {
      actor: user,
      tokenAddress: token,
      amount,
      ...(valuation.amountUsd === undefined ? {} : { amountUsd: valuation.amountUsd }),
      metadata: eventType === "repaid" ? JSON.stringify({ payer }) : "{}",
    }),
  );
  await markTokenAnalytics(context, base, token, { hasDebt: true });
  await updateTokenAnalytics(
    context,
    base,
    token,
    eventType === "borrowed"
      ? { borrowedCount: 1n, borrowedAmount: amount, borrowedUsd: valuation.amountUsd ?? 0n }
      : { repaidCount: 1n, repaidAmount: amount, repaidUsd: valuation.amountUsd ?? 0n },
  );
  await bumpDaily(
    context,
    base,
    eventType === "borrowed" ? { borrowedUsd: valuation.amountUsd ?? 0n } : { repaidUsd: valuation.amountUsd ?? 0n },
  );
}

for (const [contract, managerVersion] of [
  ["DebtManager", "current"],
  ["DebtManagerLegacy", "legacy"],
] as const) {
  indexer.onEvent({ contract, event: "Supplied" }, async ({ event, context }) =>
    recordDebtEvent(event, context, managerVersion, "supplied"),
  );
  indexer.onEvent({ contract, event: "Borrowed" }, async ({ event, context }) =>
    recordDebtEvent(event, context, managerVersion, "borrowed"),
  );
  indexer.onEvent({ contract, event: "Repaid" }, async ({ event, context }) =>
    recordDebtEvent(event, context, managerVersion, "repaid"),
  );
  indexer.onEvent({ contract, event: "Liquidated" }, async ({ event, context }) => {
    const base = event as unknown as BlockEvent;
    const debtManager = lower(event.srcAddress);
    const user = lower(event.params.user);
    const token = lower(event.params.debtTokenToLiquidate);
    const liquidator = lower(event.params.liquidator);
    const amount = event.params.debtAmountLiquidated;
    const id = eventId(event.chainId, event.transaction.hash, event.logIndex);
    const canonical = await canonicalAction(
      context,
      base,
      "debt_liquidation",
      user,
      undefined,
      JSON.stringify({ liquidator }),
    );
    const debtValuation = await canonicalTokenLeg(
      context,
      base,
      canonical.id,
      user,
      token,
      0,
      "liquidation_repayment",
      "out",
      amount,
      undefined,
      undefined,
      { affectsSafeBalance: false },
    );
    for (let index = 0; index < event.params.userCollateralLiquidated.length; index += 1) {
      const collateral = event.params.userCollateralLiquidated[index];
      if (!collateral) continue;
      await canonicalTokenLeg(
        context,
        base,
        canonical.id,
        user,
        collateral.token,
        index + 1,
        "other",
        "out",
        collateral.amount,
        undefined,
        undefined,
        { affectsSafeBalance: false },
      );
    }
    await canonicalAccountMetric(context, base, user, { repaidUsd: debtValuation.amountUsd ?? null });
    context.DebtEvent.set({
      id,
      chainId: event.chainId,
      debtManager,
      managerVersion,
      eventType: "liquidated",
      user,
      payer: liquidator,
      tokenAddress: token,
      amount,
      amountUsd: debtValuation.amountUsd,
      usdStatus: debtValuation.status,
      blockNumber: asBigInt(event.block.number),
      timestamp: ts(base),
      transactionHash: lower(event.transaction.hash),
      logIndex: event.logIndex,
    });
    const positionId = `${event.chainId}:${debtManager}:${user}:${token}`;
    const current = (await context.DebtPosition.get(positionId)) ?? {
      id: positionId,
      chainId: event.chainId,
      debtManager,
      user,
      tokenAddress: token,
      borrowedAmount: 0n,
      repaidAmount: 0n,
      liquidatedAmount: 0n,
      outstandingAmount: 0n,
      borrowedUsd: 0n,
      repaidUsd: 0n,
      liquidatedUsd: 0n,
      outstandingUsd: 0n,
      usdStatus: "event_ledger_empty",
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    };
    const liquidatedAmount = current.liquidatedAmount + amount;
    const liquidatedUsd = current.liquidatedUsd + (debtValuation.amountUsd ?? 0n);
    context.DebtPosition.set({
      ...current,
      liquidatedAmount,
      outstandingAmount: current.borrowedAmount - current.repaidAmount - liquidatedAmount,
      liquidatedUsd,
      outstandingUsd: current.borrowedUsd - current.repaidUsd - liquidatedUsd,
      usdStatus:
        debtValuation.amountUsd === undefined ||
        ["unpriced_event_only", "event_ledger_partial"].includes(current.usdStatus)
          ? "event_ledger_partial"
          : "event_ledger_priced",
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    });
    context.ProtocolEvent.set(
      protocolEvent(base, "debt_liquidated", {
        actor: user,
        tokenAddress: token,
        amount,
        ...(debtValuation.amountUsd === undefined ? {} : { amountUsd: debtValuation.amountUsd }),
        metadata: JSON.stringify({
          liquidator,
          beforeDebtAmount: String(event.params.beforeDebtAmount),
          collateral: event.params.userCollateralLiquidated.map((item) => ({
            token: lower(item.token),
            amount: String(item.amount),
            liquidationBonus: String(item.liquidationBonus),
          })),
        }),
      }),
    );
    await markTokenAnalytics(context, base, token, { hasDebt: true });
    await bumpDaily(context, base, { repaidUsd: debtValuation.amountUsd ?? 0n });
  });
  indexer.onEvent({ contract, event: "InterestIndexUpdated" }, async ({ event, context }) => {
    const base = event as unknown as BlockEvent;
    const debtManager = lower(event.srcAddress);
    const token = lower(event.params.borrowToken);
    context.DebtInterestIndex.set({
      id: eventId(event.chainId, event.transaction.hash, event.logIndex),
      chainId: event.chainId,
      debtManager,
      managerVersion,
      tokenAddress: token,
      oldIndex: event.params.oldIndex,
      newIndex: event.params.newIndex,
      blockNumber: asBigInt(event.block.number),
      timestamp: ts(base),
      transactionHash: lower(event.transaction.hash),
      logIndex: event.logIndex,
    });
    context.ProtocolEvent.set(
      protocolEvent(base, "debt_interest_index_updated", {
        tokenAddress: token,
        amount: event.params.newIndex,
        metadata: JSON.stringify({ oldIndex: String(event.params.oldIndex), newIndex: String(event.params.newIndex) }),
      }),
    );
    await recordToken(context, base, token);
  });
}

// Lend Gateway and Aave V4 Spoke handlers intentionally do not update the
// legacy DebtPosition ledger. A single Gateway operation normally produces a
// corresponding Spoke log in the same transaction; retaining both immutable
// provenance rows while correlating one EconomicAction prevents double count.
const AAVE_V4_SPOKE_BY_CHAIN: Record<number, string> = {
  10: "0xdffcc3536d932eb51df51a7f5fa407c4270d5308",
};
const LEND_GATEWAY_BY_CHAIN: Record<number, string> = {
  10: "0x01f8cdfb1694ea8fe4ed6c38a0fd78d1188e03f4",
};
const lendingEventId = (event: BlockEvent) => eventId(event.chainId, event.transaction.hash, event.logIndex);
const lendingReserveId = (chainId: number, spokeAddress: string, reserveId: bigint | number) =>
  `${chainId}:${lower(spokeAddress)}:${String(reserveId)}`;
const lendingGatewayReserveLookupId = (chainId: number, gatewayAddress: string, tokenAddress: string) =>
  `${chainId}:${lower(gatewayAddress)}:${lower(tokenAddress)}`;

type ReservePlanItem = { reserveId: string; tokenAddress: string | null };

function readReservePlan(value: string | undefined): ReservePlanItem[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as ReservePlanItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function updateLendingMarketReservePlan(
  context: any,
  marketId: string,
  reserveId: bigint,
  tokenAddress: string | null,
  active: boolean,
) {
  const market = await context.LendingMarket.get(marketId);
  if (!market) return;
  const items = new Map(readReservePlan(market.reservePlan).map((item) => [item.reserveId, item]));
  const key = String(reserveId);
  if (active) items.set(key, { reserveId: key, tokenAddress: tokenAddress ? lower(tokenAddress) : null });
  else items.delete(key);
  context.LendingMarket.set({
    ...market,
    reservePlan: JSON.stringify(
      [...items.values()].sort((a, b) => (BigInt(a.reserveId) < BigInt(b.reserveId) ? -1 : 1)),
    ),
  });
}

function optionalBigInt(value: unknown): bigint | undefined {
  return typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : undefined;
}

async function applyLendingPositionDelta(
  context: any,
  event: BlockEvent,
  safeAddress: string,
  marketId: string,
  reserveId: bigint,
  delta: {
    suppliedShares?: bigint;
    drawnShares?: bigint;
    premiumShares?: bigint;
    premiumOffsetRay?: bigint;
    usingAsCollateral?: boolean;
  },
) {
  const accountAddress = await canonicalAccount(context, event, safeAddress);
  const reserveKey = `${marketId}:${String(reserveId)}`;
  const id = `${event.chainId}:${accountAddress}:${reserveKey}`;
  const current = (await context.LendingPosition.get(id)) ?? {
    id,
    accountIdentityId: accountAddress,
    reserveId: reserveKey,
    chainId: event.chainId,
    stateStatus: "event_derived",
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    suppliedShares: 0n,
    drawnShares: 0n,
    premiumShares: 0n,
    premiumOffsetRay: 0n,
    valuationStatus: "unpriced",
    stateSource: "events",
    finalityStatus: "envio_reorg_aware",
  };
  context.LendingPosition.set({
    ...current,
    suppliedShares: (current.suppliedShares ?? 0n) + (delta.suppliedShares ?? 0n),
    drawnShares: (current.drawnShares ?? 0n) + (delta.drawnShares ?? 0n),
    premiumShares: (current.premiumShares ?? 0n) + (delta.premiumShares ?? 0n),
    premiumOffsetRay: (current.premiumOffsetRay ?? 0n) + (delta.premiumOffsetRay ?? 0n),
    ...(delta.usingAsCollateral === undefined ? {} : { usingAsCollateral: delta.usingAsCollateral }),
    stateStatus: "event_derived",
    stateBlockNumber: asBigInt(event.block.number),
    stateBlockHash: event.block.hash,
    stateObservedAt: ts(event),
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
}

async function refreshLendingSnapshot(
  context: any,
  event: BlockEvent,
  rawSafe: string,
  marketId: string,
  riskChanging = false,
) {
  const market = await context.LendingMarket.get(marketId);
  if (!market) return;
  const reservePlan = market.reservePlan ?? "[]";
  if (readReservePlan(reservePlan).length === 0) return;
  const safeAddress = lower(rawSafe);
  const discriminator = riskChanging
    ? `block:${String(event.block.number)}`
    : `bucket:${fifteenMinuteBucket(ts(event))}`;
  const snapshotId = `${event.chainId}:${safeAddress}:${marketId}:${discriminator}`;
  const previous = await context.LendingAccountSnapshot.get(snapshotId);
  if (previous) return;
  const effect = await context.effect(lendingStateSnapshotEffect, {
    safeAddress,
    spokeAddress: market.spokeAddress,
    marketId,
    blockNumber: String(event.block.number),
    blockHash: event.block.hash,
    reservePlan,
  });
  const decoded = decodeSnapshotEffectResult(effect);
  if (!decoded.snapshot) {
    context.LendingAccountSnapshot.set({
      id: snapshotId,
      accountIdentityId: safeAddress,
      chainId: event.chainId,
      marketId,
      blockNumber: asBigInt(event.block.number),
      snapshotKind: riskChanging ? "risk_event" : "activity_15m",
      valuationStatus: "unpriced",
      stateStatus: "unavailable",
      error: decoded.error,
      stateSource: "archive_multicall",
      finalityStatus: "envio_reorg_aware",
      observedAt: ts(event),
    });
    return;
  }
  const account = Array.isArray(decoded.snapshot.account) ? decoded.snapshot.account : null;
  const positions = Array.isArray(decoded.snapshot.positions) ? decoded.snapshot.positions : [];
  const blockHash = typeof decoded.snapshot.blockHash === "string" ? decoded.snapshot.blockHash : event.block.hash;
  context.LendingAccountSnapshot.set({
    id: snapshotId,
    accountIdentityId: safeAddress,
    chainId: event.chainId,
    marketId,
    blockNumber: asBigInt(event.block.number),
    blockHash,
    snapshotKind: riskChanging ? "risk_event" : "activity_15m",
    riskPremiumRay: optionalBigInt(account?.[0]),
    avgCollateralFactorE18: optionalBigInt(account?.[1]),
    healthFactorE18: optionalBigInt(account?.[2]),
    totalCollateralValueRaw: optionalBigInt(account?.[3]),
    totalDebtValueRayRaw: optionalBigInt(account?.[4]),
    activeCollateralCount: account?.[5] === undefined ? undefined : Number(account[5]),
    borrowCount: account?.[6] === undefined ? undefined : Number(account[6]),
    valuationStatus: "unpriced",
    stateStatus: decoded.status,
    stateSource: "archive_multicall",
    finalityStatus: "envio_reorg_aware",
    observedAt: ts(event),
  });
  for (const raw of positions) {
    if (!raw || typeof raw !== "object") continue;
    const position = raw as Record<string, unknown>;
    const reserveId = optionalBigInt(position.reserveId);
    if (reserveId === undefined) continue;
    const reserveKey = `${marketId}:${String(reserveId)}`;
    const positionId = `${event.chainId}:${safeAddress}:${reserveKey}`;
    const current = await context.LendingPosition.get(positionId);
    const walletBalance = optionalBigInt(position.walletBalance);
    const suppliedBalance = optionalBigInt(position.suppliedBalance);
    const drawnShares = optionalBigInt(position.drawnShares);
    const suppliedShares = optionalBigInt(position.suppliedShares);
    const premiumShares = optionalBigInt(position.premiumShares);
    const premiumOffsetRay = optionalBigInt(position.premiumOffsetRay);
    const protocolDebt = optionalBigInt(position.totalDebt);
    const usingAsCollateral =
      typeof position.enabledAsCollateral === "boolean" ? position.enabledAsCollateral : undefined;
    context.LendingPositionSnapshot.set({
      id: `${positionId}:${String(event.block.number)}:${riskChanging ? "risk" : "activity"}`,
      lendingPositionId: positionId,
      accountIdentityId: safeAddress,
      reserveId: reserveKey,
      chainId: event.chainId,
      blockNumber: asBigInt(event.block.number),
      blockHash,
      snapshotKind: riskChanging ? "risk_event" : "activity_15m",
      walletBalance,
      suppliedBalance,
      drawnShares,
      suppliedShares,
      premiumShares,
      premiumOffsetRay,
      usingAsCollateral,
      protocolDebt,
      valuationStatus: "unpriced",
      stateStatus: decoded.status,
      stateSource: "archive_multicall",
      finalityStatus: "envio_reorg_aware",
      observedAt: ts(event),
    });
    context.LendingPosition.set({
      ...(current ?? {
        id: positionId,
        accountIdentityId: safeAddress,
        reserveId: reserveKey,
        chainId: event.chainId,
        updatedAt: ts(event),
        updatedBlock: asBigInt(event.block.number),
      }),
      walletBalance,
      suppliedBalance,
      drawnShares,
      suppliedShares,
      premiumShares,
      premiumOffsetRay,
      usingAsCollateral,
      protocolDebt,
      valuationStatus: "unpriced",
      stateStatus: decoded.status,
      stateSource: "archive_multicall",
      finalityStatus: "envio_reorg_aware",
      stateBlockNumber: asBigInt(event.block.number),
      stateBlockHash: blockHash,
      stateObservedAt: ts(event),
      updatedAt: ts(event),
      updatedBlock: asBigInt(event.block.number),
    });
  }
}

async function recordLendingSourceEvent(
  context: any,
  event: any,
  sourceKind: "gateway" | "spoke",
  eventType: string,
  fields: Partial<{
    safeAddress: string;
    actorAddress: string;
    recipientAddress: string;
    reserveId: bigint;
    collateralReserveId: bigint;
    debtReserveId: bigint;
    metadata: string;
  }> = {},
) {
  const base = event as BlockEvent;
  const id = lendingEventId(base);
  context.LendingSourceEvent.set({
    id,
    chainId: event.chainId,
    sourceKind,
    sourceAddress: lower(event.srcAddress),
    // For Aave V4 the user-facing market is the Spoke. Keep both names so
    // downstream consumers do not have to infer that protocol convention.
    marketAddress:
      sourceKind === "spoke" ? lower(event.srcAddress) : (AAVE_V4_SPOKE_BY_CHAIN[event.chainId] ?? ZERO_ADDRESS),
    spokeAddress:
      sourceKind === "spoke" ? lower(event.srcAddress) : (AAVE_V4_SPOKE_BY_CHAIN[event.chainId] ?? ZERO_ADDRESS),
    eventType,
    ...(fields.safeAddress ? { safeAddress: lower(fields.safeAddress) } : {}),
    ...(fields.actorAddress ? { actorAddress: lower(fields.actorAddress) } : {}),
    ...(fields.recipientAddress ? { recipientAddress: lower(fields.recipientAddress) } : {}),
    ...(fields.reserveId !== undefined ? { reserveId: fields.reserveId } : {}),
    ...(fields.collateralReserveId !== undefined ? { collateralReserveId: fields.collateralReserveId } : {}),
    ...(fields.debtReserveId !== undefined ? { debtReserveId: fields.debtReserveId } : {}),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
    metadata: fields.metadata ?? "{}",
  });
  const marketAddress =
    sourceKind === "spoke" ? lower(event.srcAddress) : (AAVE_V4_SPOKE_BY_CHAIN[event.chainId] ?? ZERO_ADDRESS);
  const marketId = `${event.chainId}:${marketAddress}`;
  const market = await context.LendingMarket.get(marketId);
  context.LendingMarket.set(
    market ?? {
      id: marketId,
      chainId: event.chainId,
      address: marketAddress,
      spokeAddress: marketAddress,
      gatewayAddress: sourceKind === "gateway" ? lower(event.srcAddress) : undefined,
      reservePlan: "[]",
      registeredAt: ts(base),
    },
  );
  const accountAddress = fields.safeAddress ? await canonicalAccount(context, base, fields.safeAddress) : undefined;
  const reserveDiscriminator = [fields.reserveId, fields.collateralReserveId, fields.debtReserveId]
    .filter((value) => value !== undefined)
    .map(String)
    .join(":");
  const economicKey = accountAddress
    ? `${event.chainId}:${lower(event.transaction.hash)}:${accountAddress}:${eventType}:${reserveDiscriminator}`
    : undefined;
  const actionId = economicKey ? `lending:${economicKey}` : undefined;
  if (actionId && accountAddress) {
    const existingAction = await context.EconomicAction.get(actionId);
    context.EconomicAction.set({
      ...(existingAction ?? {
        id: actionId,
        chainId: event.chainId,
        accountIdentityId: accountAddress,
        accountAddress,
        actionType: eventType,
        transactionHash: lower(event.transaction.hash),
        blockNumber: asBigInt(event.block.number),
        timestamp: ts(base),
        logIndex: event.logIndex,
        valuationStatus: "unpriced",
        sourceCount: 0,
        economicKey,
        metadata: fields.metadata ?? "{}",
      }),
      sourceCount: (existingAction?.sourceCount ?? 0) + 1,
    });
    context.EconomicActionSource.set({
      id: `${id}:source`,
      economicActionId: actionId,
      sourceEventId: id,
      sourceKind,
      sourceRole: sourceKind === "spoke" ? "state_change" : "gateway_intent",
    });
    if (!existingAction) await canonicalAccountMetric(context, base, accountAddress, {});
  }
  context.ScannerEvent.set({
    id,
    chainId: event.chainId,
    eventType: `lending_${eventType}`,
    contractAddress: lower(event.srcAddress),
    ...(accountAddress ? { actorAddress: accountAddress } : {}),
    transactionHash: lower(event.transaction.hash),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    logIndex: event.logIndex,
    usdStatus: "unpriced",
  });
  const reserveKey = fields.reserveId === undefined ? undefined : `${marketId}:${String(fields.reserveId)}`;
  context.LendingEvent.set({
    id,
    chainId: event.chainId,
    ...(accountAddress ? { accountIdentityId: accountAddress, accountAddress } : {}),
    marketId,
    ...(reserveKey ? { reserveId: reserveKey } : {}),
    ...(actionId ? { economicActionId: actionId } : {}),
    eventType,
    sourceKind,
    sourceAddress: lower(event.srcAddress),
    transactionHash: lower(event.transaction.hash),
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    logIndex: event.logIndex,
    metadata: fields.metadata ?? "{}",
  });
  return id;
}

async function recordLendingLeg(
  context: any,
  sourceEventId: string,
  event: any,
  legIndex: number,
  legType: string,
  reserveId: bigint | number | undefined,
  tokenAddress: string | undefined,
  amount: bigint,
  shares: bigint,
  direction: "increase" | "decrease" | "informational",
  premium: Partial<{
    suppliedSharesDelta: bigint;
    drawnSharesDelta: bigint;
    premiumSharesDelta: bigint;
    premiumOffsetRayDelta: bigint;
  }> = {},
) {
  context.LendingSourceEventLeg.set({
    id: `${sourceEventId}:${legIndex}`,
    sourceEventId,
    chainId: event.chainId,
    legIndex,
    legType,
    ...(reserveId !== undefined ? { reserveId: BigInt(reserveId) } : {}),
    ...(tokenAddress ? { tokenAddress: lower(tokenAddress) } : {}),
    amount,
    shares,
    suppliedSharesDelta: premium.suppliedSharesDelta ?? 0n,
    drawnSharesDelta: premium.drawnSharesDelta ?? 0n,
    premiumSharesDelta: premium.premiumSharesDelta ?? 0n,
    premiumOffsetRayDelta: premium.premiumOffsetRayDelta ?? 0n,
    direction,
  });
  const marketAddress =
    lower(event.srcAddress) === (LEND_GATEWAY_BY_CHAIN[event.chainId] ?? "")
      ? (AAVE_V4_SPOKE_BY_CHAIN[event.chainId] ?? ZERO_ADDRESS)
      : lower(event.srcAddress);
  const marketId = `${event.chainId}:${marketAddress}`;
  context.LendingEventLeg.set({
    id: `${sourceEventId}:${legIndex}`,
    lendingEventId: sourceEventId,
    ...(reserveId === undefined ? {} : { reserveId: `${marketId}:${String(reserveId)}` }),
    ...(tokenAddress ? { tokenAddress: lower(tokenAddress) } : {}),
    legIndex,
    legType,
    direction,
    amount,
    shares,
    suppliedSharesDelta: premium.suppliedSharesDelta ?? 0n,
    drawnSharesDelta: premium.drawnSharesDelta ?? 0n,
    premiumSharesDelta: premium.premiumSharesDelta ?? 0n,
    premiumOffsetRayDelta: premium.premiumOffsetRayDelta ?? 0n,
    valuationStatus: "unpriced",
  });
  if (tokenAddress) {
    await recordToken(context, event as BlockEvent, tokenAddress);
    context.ScannerEventTokenLeg.set({
      id: `${sourceEventId}:${legIndex}`,
      scannerEvent_id: sourceEventId,
      token_id: `${event.chainId}:${lower(tokenAddress)}`,
      legIndex,
      tokenAddress: lower(tokenAddress),
      amount,
      direction: direction === "increase" ? "in" : direction === "decrease" ? "out" : "neutral",
      priceStatus: "unpriced",
    });
  }
  if (!tokenAddress) return;
  const lendingEvent = await context.LendingEvent.get(sourceEventId);
  if (!lendingEvent?.accountAddress || lendingEvent.sourceKind !== "spoke" || !lendingEvent.economicActionId) return;
  const canonicalType =
    legType === "borrow" ? "borrow" : legType === "repay" || legType === "debt_restored" ? "repay" : "other";
  const canonicalDirection = canonicalType === "borrow" ? "in" : canonicalType === "repay" ? "out" : "neutral";
  const valuation = await canonicalTokenLeg(
    context,
    event as BlockEvent,
    lendingEvent.economicActionId,
    lendingEvent.accountAddress,
    tokenAddress,
    legIndex,
    canonicalType,
    canonicalDirection,
    amount,
    undefined,
    canonicalType === "borrow" ? "credit" : undefined,
    { affectsSafeBalance: false, createScannerLeg: false },
  );
  if (canonicalType === "borrow" || canonicalType === "repay")
    await canonicalAccountMetric(
      context,
      event as BlockEvent,
      lendingEvent.accountAddress,
      canonicalType === "borrow"
        ? { borrowedUsd: valuation.amountUsd ?? null }
        : { repaidUsd: valuation.amountUsd ?? null },
      false,
    );
}

async function lendingReserve(context: any, event: any, reserveId: bigint) {
  const spokeAddress = lower(event.srcAddress);
  return context.LendingReserveState.get(lendingReserveId(event.chainId, spokeAddress, reserveId));
}

async function lendingGatewayReserve(context: any, event: any, asset: string) {
  return context.LendingGatewayReserveLookup.get(lendingGatewayReserveLookupId(event.chainId, event.srcAddress, asset));
}

for (const eventName of ["Supplied", "Withdrawn", "Borrowed", "Repaid"] as const) {
  indexer.onEvent({ contract: "LendGateway", event: eventName }, async ({ event, context }) => {
    const eventType =
      eventName === "Supplied"
        ? "supply"
        : eventName === "Withdrawn"
          ? "withdraw"
          : eventName === "Borrowed"
            ? "borrow"
            : "repay";
    const reserve = await lendingGatewayReserve(context, event, event.params.asset);
    const id = await recordLendingSourceEvent(context, event, "gateway", eventType, {
      safeAddress: event.params.safe,
      recipientAddress: "to" in event.params ? event.params.to : undefined,
      reserveId: reserve?.active ? reserve.reserveId : undefined,
    });
    await recordLendingLeg(
      context,
      id,
      event,
      0,
      eventType,
      reserve?.active ? reserve.reserveId : undefined,
      event.params.asset,
      event.params.amount,
      0n,
      eventType === "supply" || eventType === "borrow" ? "increase" : "decrease",
    );
  });
}

indexer.onEvent({ contract: "LendGateway", event: "CollateralUsageSet" }, async ({ event, context }) => {
  const reserve = await lendingGatewayReserve(context, event, event.params.asset);
  await recordLendingSourceEvent(
    context,
    event,
    "gateway",
    event.params.useAsCollateral ? "collateral_enable" : "collateral_disable",
    {
      safeAddress: event.params.safe,
      reserveId: reserve?.active ? reserve.reserveId : undefined,
      metadata: JSON.stringify({ asset: lower(event.params.asset) }),
    },
  );
});

indexer.onEvent({ contract: "LendGateway", event: "PositionManagerApproved" }, async ({ event, context }) => {
  await recordLendingSourceEvent(context, event, "gateway", "position_manager_update", {
    safeAddress: event.params.safe,
    actorAddress: event.srcAddress,
    metadata: JSON.stringify({ approved: true }),
  });
});

indexer.onEvent({ contract: "LendGateway", event: "ReserveRegistered" }, async ({ event, context }) => {
  const id = await recordLendingSourceEvent(context, event, "gateway", "reserve_registered", {
    reserveId: event.params.reserveId,
    metadata: JSON.stringify({ asset: lower(event.params.asset) }),
  });
  const spokeAddress = AAVE_V4_SPOKE_BY_CHAIN[event.chainId] ?? ZERO_ADDRESS;
  const reserveKey = lendingReserveId(event.chainId, spokeAddress, event.params.reserveId);
  const existing = await context.LendingReserveState.get(reserveKey);
  context.LendingReserveState.set({
    ...(existing ?? {
      id: reserveKey,
      chainId: event.chainId,
      marketAddress: spokeAddress,
      spokeAddress,
      gatewayAddress: lower(event.srcAddress),
      reserveId: event.params.reserveId,
      hubAssetId: 0n,
      hubAddress: ZERO_ADDRESS,
    }),
    tokenAddress: lower(event.params.asset),
    gatewayAddress: lower(event.srcAddress),
    gatewayRegistered: true,
    active: true,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
  context.LendingGatewayReserveLookup.set({
    id: lendingGatewayReserveLookupId(event.chainId, event.srcAddress, event.params.asset),
    chainId: event.chainId,
    gatewayAddress: lower(event.srcAddress),
    tokenAddress: lower(event.params.asset),
    spokeAddress,
    reserveId: event.params.reserveId,
    active: true,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
  context.LendingReserve.set({
    id: `${event.chainId}:${spokeAddress}:${String(event.params.reserveId)}`,
    marketId: `${event.chainId}:${spokeAddress}`,
    chainId: event.chainId,
    reserveId: event.params.reserveId,
    tokenAddress: lower(event.params.asset),
    token_id: `${event.chainId}:${lower(event.params.asset)}`,
    assetStatus: "event_mapped",
    active: true,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
  });
  await updateLendingMarketReservePlan(
    context,
    `${event.chainId}:${spokeAddress}`,
    event.params.reserveId,
    event.params.asset,
    true,
  );
  await recordLendingLeg(
    context,
    id,
    event,
    0,
    "reserve_mapping",
    event.params.reserveId,
    event.params.asset,
    0n,
    0n,
    "informational",
  );
});

indexer.onEvent({ contract: "LendGateway", event: "ReserveDeregistered" }, async ({ event, context }) => {
  const lookupId = lendingGatewayReserveLookupId(event.chainId, event.srcAddress, event.params.asset);
  const lookup = await context.LendingGatewayReserveLookup.get(lookupId);
  await recordLendingSourceEvent(context, event, "gateway", "reserve_deregistered", {
    reserveId: lookup?.reserveId,
    metadata: JSON.stringify({ asset: lower(event.params.asset) }),
  });
  if (!lookup) return;
  context.LendingGatewayReserveLookup.set({
    ...lookup,
    active: false,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
  const reserveKey = lendingReserveId(event.chainId, lookup.spokeAddress, lookup.reserveId);
  const reserve = await context.LendingReserveState.get(reserveKey);
  if (!reserve) return;
  context.LendingReserveState.set({
    ...reserve,
    active: false,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
  const canonicalReserve = await context.LendingReserve.get(
    `${event.chainId}:${lookup.spokeAddress}:${String(lookup.reserveId)}`,
  );
  if (canonicalReserve)
    context.LendingReserve.set({
      ...canonicalReserve,
      active: false,
      updatedAt: ts(event),
      updatedBlock: asBigInt(event.block.number),
    });
  await updateLendingMarketReservePlan(
    context,
    `${event.chainId}:${lookup.spokeAddress}`,
    lookup.reserveId,
    lookup.tokenAddress,
    false,
  );
});

indexer.onEvent({ contract: "AaveV4Spoke", event: "AddReserve" }, async ({ event, context }) => {
  const id = await recordLendingSourceEvent(context, event, "spoke", "reserve_registered", {
    reserveId: event.params.reserveId,
    actorAddress: event.params.hub,
    metadata: JSON.stringify({ assetId: String(event.params.assetId) }),
  });
  const reserveKey = lendingReserveId(event.chainId, event.srcAddress, event.params.reserveId);
  const existing = await context.LendingReserveState.get(reserveKey);
  context.LendingReserveState.set({
    ...(existing ?? {
      id: reserveKey,
      chainId: event.chainId,
      marketAddress: lower(event.srcAddress),
      spokeAddress: lower(event.srcAddress),
      gatewayAddress: LEND_GATEWAY_BY_CHAIN[event.chainId] ?? ZERO_ADDRESS,
      reserveId: event.params.reserveId,
      tokenAddress: undefined,
      gatewayRegistered: false,
    }),
    hubAssetId: event.params.assetId,
    hubAddress: lower(event.params.hub),
    active: true,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
  await updateLendingMarketReservePlan(
    context,
    `${event.chainId}:${lower(event.srcAddress)}`,
    event.params.reserveId,
    existing?.tokenAddress ?? null,
    true,
  );
  // AddReserve exposes no underlying token; wait for Gateway registration to
  // establish it rather than emitting a synthetic zero-address token leg.
  if (existing?.tokenAddress)
    await recordLendingLeg(
      context,
      id,
      event,
      0,
      "reserve_mapping",
      event.params.reserveId,
      existing.tokenAddress,
      0n,
      0n,
      "informational",
    );
});

for (const eventName of ["Supply", "Withdraw", "Borrow", "Repay"] as const) {
  indexer.onEvent({ contract: "AaveV4Spoke", event: eventName }, async ({ event, context }) => {
    const params: any = event.params;
    const eventType =
      eventName === "Supply"
        ? "supply"
        : eventName === "Withdraw"
          ? "withdraw"
          : eventName === "Borrow"
            ? "borrow"
            : "repay";
    const reserve = await lendingReserve(context, event, params.reserveId);
    const amount =
      eventName === "Supply"
        ? params.suppliedAmount
        : eventName === "Withdraw"
          ? params.withdrawnAmount
          : eventName === "Borrow"
            ? params.drawnAmount
            : params.totalAmountRepaid;
    const shares =
      eventName === "Supply"
        ? params.suppliedShares
        : eventName === "Withdraw"
          ? params.withdrawnShares
          : params.drawnShares;
    const id = await recordLendingSourceEvent(context, event, "spoke", eventType, {
      safeAddress: params.user,
      actorAddress: params.caller,
      reserveId: params.reserveId,
    });
    await recordLendingLeg(
      context,
      id,
      event,
      0,
      eventType,
      params.reserveId,
      reserve?.tokenAddress,
      amount,
      shares,
      eventType === "supply" || eventType === "borrow" ? "increase" : "decrease",
      {
        suppliedSharesDelta: eventName === "Supply" ? shares : eventName === "Withdraw" ? -shares : 0n,
        drawnSharesDelta: eventName === "Borrow" ? shares : eventName === "Repay" ? -shares : 0n,
        premiumSharesDelta: eventName === "Repay" ? params.premiumDelta.sharesDelta : 0n,
        premiumOffsetRayDelta: eventName === "Repay" ? params.premiumDelta.offsetRayDelta : 0n,
      },
    );
    const marketId = `${event.chainId}:${lower(event.srcAddress)}`;
    await applyLendingPositionDelta(context, event as unknown as BlockEvent, params.user, marketId, params.reserveId, {
      suppliedShares: eventName === "Supply" ? shares : eventName === "Withdraw" ? -shares : 0n,
      drawnShares: eventName === "Borrow" ? shares : eventName === "Repay" ? -shares : 0n,
      premiumShares: eventName === "Repay" ? params.premiumDelta.sharesDelta : 0n,
      premiumOffsetRay: eventName === "Repay" ? params.premiumDelta.offsetRayDelta : 0n,
    });
    await refreshLendingSnapshot(context, event as unknown as BlockEvent, params.user, marketId);
  });
}

indexer.onEvent({ contract: "AaveV4Spoke", event: "SetUsingAsCollateral" }, async ({ event, context }) => {
  const reserve = await lendingReserve(context, event, event.params.reserveId);
  await recordLendingSourceEvent(
    context,
    event,
    "spoke",
    event.params.usingAsCollateral ? "collateral_enable" : "collateral_disable",
    {
      safeAddress: event.params.user,
      actorAddress: event.params.caller,
      reserveId: event.params.reserveId,
      metadata: JSON.stringify({ asset: reserve?.tokenAddress ?? null }),
    },
  );
  const marketId = `${event.chainId}:${lower(event.srcAddress)}`;
  await applyLendingPositionDelta(
    context,
    event as unknown as BlockEvent,
    event.params.user,
    marketId,
    event.params.reserveId,
    { usingAsCollateral: event.params.usingAsCollateral },
  );
  await refreshLendingSnapshot(context, event as unknown as BlockEvent, event.params.user, marketId);
});

indexer.onEvent({ contract: "AaveV4Spoke", event: "SetUserPositionManager" }, async ({ event, context }) => {
  await recordLendingSourceEvent(context, event, "spoke", "position_manager_update", {
    safeAddress: event.params.user,
    actorAddress: event.params.positionManager,
    metadata: JSON.stringify({ approved: event.params.approve }),
  });
});

indexer.onEvent({ contract: "AaveV4Spoke", event: "ReportDeficit" }, async ({ event, context }) => {
  const reserve = await lendingReserve(context, event, event.params.reserveId);
  const id = await recordLendingSourceEvent(context, event, "spoke", "deficit", {
    safeAddress: event.params.user,
    reserveId: event.params.reserveId,
    metadata: JSON.stringify({ restoredPremiumRay: String(event.params.premiumDelta.restoredPremiumRay) }),
  });
  await recordLendingLeg(
    context,
    id,
    event,
    0,
    "deficit",
    event.params.reserveId,
    reserve?.tokenAddress,
    0n,
    event.params.drawnShares,
    "decrease",
    {
      drawnSharesDelta: -event.params.drawnShares,
      premiumSharesDelta: event.params.premiumDelta.sharesDelta,
      premiumOffsetRayDelta: event.params.premiumDelta.offsetRayDelta,
    },
  );
  const marketId = `${event.chainId}:${lower(event.srcAddress)}`;
  await applyLendingPositionDelta(
    context,
    event as unknown as BlockEvent,
    event.params.user,
    marketId,
    event.params.reserveId,
    {
      drawnShares: -event.params.drawnShares,
      premiumShares: event.params.premiumDelta.sharesDelta,
      premiumOffsetRay: event.params.premiumDelta.offsetRayDelta,
    },
  );
  await refreshLendingSnapshot(context, event as unknown as BlockEvent, event.params.user, marketId, true);
});

indexer.onEvent({ contract: "AaveV4Spoke", event: "LiquidationCall" }, async ({ event, context }) => {
  const [debtReserve, collateralReserve] = await Promise.all([
    lendingReserve(context, event, event.params.debtReserveId),
    lendingReserve(context, event, event.params.collateralReserveId),
  ]);
  const id = await recordLendingSourceEvent(context, event, "spoke", "liquidation", {
    safeAddress: event.params.user,
    actorAddress: event.params.liquidator,
    collateralReserveId: event.params.collateralReserveId,
    debtReserveId: event.params.debtReserveId,
    metadata: JSON.stringify({
      receiveShares: event.params.receiveShares,
      restoredPremiumRay: String(event.params.premiumDelta.restoredPremiumRay),
    }),
  });
  await recordLendingLeg(
    context,
    id,
    event,
    0,
    "debt_restored",
    event.params.debtReserveId,
    debtReserve?.tokenAddress,
    event.params.debtAmountRestored,
    event.params.drawnSharesLiquidated,
    "decrease",
    {
      drawnSharesDelta: -event.params.drawnSharesLiquidated,
      premiumSharesDelta: event.params.premiumDelta.sharesDelta,
      premiumOffsetRayDelta: event.params.premiumDelta.offsetRayDelta,
    },
  );
  await recordLendingLeg(
    context,
    id,
    event,
    1,
    "collateral_seized",
    event.params.collateralReserveId,
    collateralReserve?.tokenAddress,
    event.params.collateralAmountRemoved,
    event.params.collateralSharesLiquidated,
    "decrease",
  );
  // This is a component of collateral_seized, not another portfolio decrease.
  await recordLendingLeg(
    context,
    id,
    event,
    2,
    "liquidation_fee",
    event.params.collateralReserveId,
    collateralReserve?.tokenAddress,
    0n,
    event.params.collateralSharesLiquidated - event.params.collateralSharesToLiquidator,
    "informational",
  );
  const marketId = `${event.chainId}:${lower(event.srcAddress)}`;
  await applyLendingPositionDelta(
    context,
    event as unknown as BlockEvent,
    event.params.user,
    marketId,
    event.params.debtReserveId,
    {
      drawnShares: -event.params.drawnSharesLiquidated,
      premiumShares: event.params.premiumDelta.sharesDelta,
      premiumOffsetRay: event.params.premiumDelta.offsetRayDelta,
    },
  );
  await applyLendingPositionDelta(
    context,
    event as unknown as BlockEvent,
    event.params.user,
    marketId,
    event.params.collateralReserveId,
    { suppliedShares: -event.params.collateralSharesLiquidated },
  );
  await refreshLendingSnapshot(context, event as unknown as BlockEvent, event.params.user, marketId, true);
});

indexer.onEvent({ contract: "RampVolumeEmitter", event: "RampVolume" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const label = bytes32Label(event.params.label);
  const token = bytes32Label(event.params.token);
  const rampKind = rampKindFromLabel(label);
  // Snapshots are keyed by their business dimensions. Chain/log order is the
  // canonical latest snapshot ordering used by the source dashboard.
  const id = `${event.chainId}:${label.toLowerCase()}:${token.toLowerCase()}:${event.params.dayTimestamp}`;
  const previous = await context.RampVolumeSnapshot.get(id);
  const fxDay = dayFromUnixSeconds(event.params.dayTimestamp);
  const dailyFx = await context.DailyFxRate.get(`${event.chainId}:eur-usd:${fxDay}`);
  const latestFx = dailyFx ?? (await context.PriceFeedState.get(`${event.chainId}:eur-usd`));
  const converted = rampAmountUsd(event.params.value, token, latestFx?.answer, latestFx?.decimals ?? 8);
  const fxStatus =
    converted.fxStatus === "chainlink" ? (dailyFx ? "chainlink_day" : "chainlink_latest") : converted.fxStatus;
  const amountUsd = converted.amountUsd;
  context.RampVolumeSnapshot.set({
    id,
    chainId: event.chainId,
    label,
    token,
    rampKind,
    dayTimestamp: event.params.dayTimestamp,
    amountRaw: event.params.value,
    rawDecimals: 6,
    amountUsd,
    fxRate: latestFx?.answer ?? 0n,
    fxDecimals: latestFx?.decimals ?? 8,
    fxStatus,
    asOf: event.params.asOf,
    usdDecimals: 6,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  });
  const delta = BigInt(amountUsd) - BigInt(previous?.amountUsd ?? 0n);
  const rampDayEvent = {
    ...base,
    block: { ...base.block, timestamp: Number(event.params.dayTimestamp) },
  };
  if (rampKind === "onramp") await bumpDaily(context, rampDayEvent, { onrampUsd: delta });
  if (rampKind === "offramp") await bumpDaily(context, rampDayEvent, { offrampUsd: delta });
  context.ProtocolEvent.set(
    protocolEvent(base, `ramp_${rampKind}`, {
      amountUsd,
      metadata: JSON.stringify({
        label,
        token,
        amountRaw: String(event.params.value),
        dayTimestamp: String(event.params.dayTimestamp),
        asOf: String(event.params.asOf),
        usdDecimals: 6,
        fxRate: String(latestFx?.answer ?? 0n),
        fxDecimals: latestFx?.decimals ?? 8,
        fxStatus,
      }),
    }),
  );
});

indexer.onEvent({ contract: "EurUsdOracle", event: "AnswerUpdated" }, async ({ event, context }) => {
  const base = event as unknown as BlockEvent;
  const feedAddress = lower(event.srcAddress);
  const transactionHash = lower(event.transaction.hash);
  const updatedBlock = asBigInt(event.block.number);
  context.PriceFeedUpdate.set({
    id: eventId(event.chainId, event.transaction.hash, event.logIndex),
    chainId: event.chainId,
    feedAddress,
    pair: "EUR/USD",
    answer: event.params.current,
    // Verified feed convention; AnswerUpdated itself does not carry decimals.
    decimals: 8,
    roundId: event.params.roundId,
    updatedAt: event.params.updatedAt,
    blockNumber: asBigInt(event.block.number),
    timestamp: ts(base),
    transactionHash,
    logIndex: event.logIndex,
  });
  const stateId = `${event.chainId}:eur-usd`;
  const currentState = await context.PriceFeedState.get(stateId);
  if (!currentState || event.params.updatedAt >= currentState.updatedAt) {
    context.PriceFeedState.set({
      id: stateId,
      chainId: event.chainId,
      feedAddress,
      pair: "EUR/USD",
      answer: event.params.current,
      decimals: 8,
      roundId: event.params.roundId,
      updatedAt: event.params.updatedAt,
      updatedBlock,
      transactionHash,
    });
  }
  const day = dayFromUnixSeconds(event.params.updatedAt);
  const dailyId = `${event.chainId}:eur-usd:${day}`;
  const currentDaily = await context.DailyFxRate.get(dailyId);
  if (!currentDaily || event.params.updatedAt >= currentDaily.updatedAt) {
    context.DailyFxRate.set({
      id: dailyId,
      chainId: event.chainId,
      feedAddress,
      pair: "EUR/USD",
      day,
      answer: event.params.current,
      decimals: 8,
      roundId: event.params.roundId,
      updatedAt: event.params.updatedAt,
      updatedBlock,
      transactionHash,
    });
  }
});

function recordSafe(context: any, event: BlockEvent, safe: string, discoveryType: string, salt = "") {
  const address = lower(safe);
  context.UserSafe.set({
    id: accountId(event.chainId, address),
    chainId: event.chainId,
    address,
    factoryAddress: lower(event.srcAddress),
    discoveryType,
    deploymentSalt: salt.toLowerCase(),
    discoveredAt: ts(event),
    discoveredBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
}

async function bumpSafeTransferBalance(
  context: any,
  event: BlockEvent,
  safeAddress: string,
  tokenAddress: string,
  inflow: bigint,
  outflow: bigint,
) {
  const safe = lower(safeAddress);
  const token = lower(tokenAddress);
  const id = `${event.chainId}:${safe}:${token}`;
  const existing = await context.SafeTokenBalance.get(id);
  const current = existing ?? {
    id,
    chainId: event.chainId,
    safeAddress: safe,
    tokenAddress: token,
    amount: 0n,
    inflow: 0n,
    outflow: 0n,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  };
  const nextAmount = applyBalanceDelta(current.amount, inflow, outflow);
  context.SafeTokenBalance.set({
    ...current,
    amount: nextAmount,
    inflow: current.inflow + inflow,
    outflow: current.outflow + outflow,
    updatedAt: ts(event),
    updatedBlock: asBigInt(event.block.number),
    transactionHash: lower(event.transaction.hash),
  });
  await applyExactWalletBalance(context, event, safe, token, nextAmount);
  await updateTokenAnalytics(context, event, token, {
    safeAccountCount: existing ? 0n : 1n,
    safeBalance: balanceChange(current.amount, nextAmount),
    safeInflow: inflow,
    safeOutflow: outflow,
  });
}

indexer.contractRegister(
  { contract: "EtherFiSafeFactory", event: "BeaconProxyDeployed" },
  async ({ event, context }) => {
    context.chain.TrackedSafeTransfer.add(event.params.deployed);
  },
);

indexer.contractRegister({ contract: "UserSafeFactory", event: "UserSafeDeployed" }, async ({ event, context }) => {
  context.chain.TrackedSafeTransfer.add(event.params.safe);
});

indexer.onEvent(
  {
    contract: "TrackedSafeTransfer",
    event: "Transfer",
    wildcard: true,
    where: ({ chain }) => ({
      params: [{ from: chain.TrackedSafeTransfer.addresses }, { to: chain.TrackedSafeTransfer.addresses }],
    }),
  },
  async ({ event, context }) => {
    const base = event as unknown as BlockEvent;
    const from = lower(event.params.from);
    const to = lower(event.params.to);
    const token = lower(event.srcAddress);
    const value = event.params.value;
    const [trackedFrom, trackedTo] = await Promise.all([
      context.UserSafe.get(accountId(event.chainId, from)),
      context.UserSafe.get(accountId(event.chainId, to)),
    ]);

    if (trackedFrom && trackedTo && from === to) {
      await bumpSafeTransferBalance(context, base, from, token, value, value);
    } else {
      if (trackedFrom) await bumpSafeTransferBalance(context, base, from, token, 0n, value);
      if (trackedTo) await bumpSafeTransferBalance(context, base, to, token, value, 0n);
    }
    await recordToken(context, base, token);
  },
);

indexer.onEvent({ contract: "EtherFiSafeFactory", event: "BeaconProxyDeployed" }, async ({ event, context }) => {
  recordSafe(context, event as unknown as BlockEvent, event.params.deployed, "beacon_proxy", event.params.salt);
});

indexer.onEvent({ contract: "UserSafeFactory", event: "UserSafeDeployed" }, async ({ event, context }) => {
  recordSafe(context, event as unknown as BlockEvent, event.params.safe, "legacy_user_safe");
});
