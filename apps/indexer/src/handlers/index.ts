import { indexer } from "envio";
import { erc20MetadataEffect } from "../erc20-metadata-effect.js";
import {
  accountId,
  applyBalanceDelta,
  asBigInt,
  balanceChange,
  bytes32Label,
  dailyMetricId,
  dayFromUnixSeconds,
  eventId,
  hourFromUnixSeconds,
  impliedUsdPriceE18,
  isLaterTokenSpend,
  rampAmountUsd,
  rampKindFromLabel,
  spendBucket,
  uniqueLowercase,
  ZERO_ADDRESS,
} from "../logic.js";
import { tokenFromRegistry } from "../token-enrichment.js";

// Alias keeps the current Cash handlers visually grouped while preserving the
// generated Envio type checks after codegen.
const cashIndexer = indexer;

type BlockEvent = {
  chainId: number;
  srcAddress: string;
  logIndex: number;
  block: { number: number | bigint; timestamp: number | bigint };
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

async function updateTokenAnalytics(context: any, event: BlockEvent, tokenAddress: string, delta: TokenAnalyticsDelta) {
  const address = lower(tokenAddress);
  await recordToken(context, event, address);
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
    borrowedAmount: current.borrowedAmount + (delta.borrowedAmount ?? 0n),
    borrowedUsd: current.borrowedUsd + (delta.borrowedUsd ?? 0n),
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
    // DebtManager emits token units only. EUR/USD cannot price arbitrary debt assets.
    amountUsd: 0n,
    usdStatus: "unpriced_event_only",
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
    outstandingUsd: 0n,
    usdStatus: "unpriced_event_only",
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  };
  const borrowedAmount = current.borrowedAmount + (eventType === "borrowed" ? amount : 0n);
  const repaidAmount = current.repaidAmount + (eventType === "repaid" ? amount : 0n);
  context.DebtPosition.set({
    ...current,
    borrowedAmount,
    repaidAmount,
    outstandingAmount: borrowedAmount - repaidAmount - current.liquidatedAmount,
    updatedAt: ts(base),
    updatedBlock: asBigInt(event.block.number),
  });
  context.ProtocolEvent.set(
    protocolEvent(base, `debt_${eventType}`, {
      actor: user,
      tokenAddress: token,
      amount,
      metadata: eventType === "repaid" ? JSON.stringify({ payer }) : "{}",
    }),
  );
  await markTokenAnalytics(context, base, token, { hasDebt: true });
  await updateTokenAnalytics(
    context,
    base,
    token,
    eventType === "borrowed"
      ? { borrowedCount: 1n, borrowedAmount: amount }
      : { repaidCount: 1n, repaidAmount: amount },
  );
  // Creates an explicit zero-USD daily row when this is the only activity;
  // the raw token event remains the canonical debt amount.
  await bumpDaily(context, base, eventType === "borrowed" ? { borrowedUsd: 0n } : { repaidUsd: 0n });
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
      amountUsd: 0n,
      usdStatus: "unpriced_event_only",
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
      outstandingUsd: 0n,
      usdStatus: "unpriced_event_only",
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    };
    const liquidatedAmount = current.liquidatedAmount + amount;
    context.DebtPosition.set({
      ...current,
      liquidatedAmount,
      outstandingAmount: current.borrowedAmount - current.repaidAmount - liquidatedAmount,
      updatedAt: ts(base),
      updatedBlock: asBigInt(event.block.number),
    });
    context.ProtocolEvent.set(
      protocolEvent(base, "debt_liquidated", {
        actor: user,
        tokenAddress: token,
        amount,
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
