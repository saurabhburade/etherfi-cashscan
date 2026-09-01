const ZERO_ADDRESS = /^0x0{40}$/i;
const positive = (value: string | null | undefined) => value != null && BigInt(value) > 0n;

export type PriceAuditMovement = {
  category: string;
  chainId: number;
  tokenAddress: string;
  amountRaw: string;
  amountUsdRaw: string | null;
  explicitPriceUsdE18?: string | null;
  valuationStatus?: string;
  transactionHash: string;
};

export type PriceAuditToken = {
  chainId: number;
  address: string;
  symbol: string;
  decimalsVerified: boolean;
  metadataStatus: string;
  oracleAddress: string;
  oraclePair: string;
  price: string;
  latestSpendPriceUsdE18: string;
};

export type PriceAuditFeed = { chainId: number; feedAddress: string; answer: string };

export function auditPriceCoverage(
  movements: PriceAuditMovement[],
  tokens: PriceAuditToken[],
  feeds: PriceAuditFeed[],
) {
  const tokenById = new Map(tokens.map((token) => [tokenId(token.chainId, token.address), token]));
  const feedsInRange = new Set(
    feeds.filter((feed) => positive(feed.answer)).map((feed) => tokenId(feed.chainId, feed.feedAddress)),
  );
  const rows = new Map<
    string,
    {
      chainId: number;
      tokenAddress: string;
      symbol: string;
      movementCount: number;
      eventPricedCount: number;
      unpricedEventCount: number;
      currentPriceCandidate: boolean;
      oracleConfigured: boolean;
      oracleObservedInRange: boolean;
      categories: Set<string>;
      sampleUnpricedTransaction: string | null;
    }
  >();

  for (const movement of movements) {
    const id = tokenId(movement.chainId, movement.tokenAddress);
    const token = tokenById.get(id);
    const eventPriced =
      positive(movement.amountUsdRaw) &&
      (positive(movement.explicitPriceUsdE18) || (positive(movement.amountRaw) && token?.decimalsVerified === true));
    const oracleConfigured = Boolean(token?.oracleAddress && !ZERO_ADDRESS.test(token.oracleAddress));
    const oracleObservedInRange = Boolean(
      oracleConfigured && feedsInRange.has(tokenId(movement.chainId, token?.oracleAddress ?? "")),
    );
    const currentPriceCandidate =
      eventPriced || positive(token?.price) || positive(token?.latestSpendPriceUsdE18) || oracleObservedInRange;
    const row = rows.get(id) ?? {
      chainId: movement.chainId,
      tokenAddress: movement.tokenAddress.toLowerCase(),
      symbol: token?.symbol || "UNKNOWN",
      movementCount: 0,
      eventPricedCount: 0,
      unpricedEventCount: 0,
      currentPriceCandidate: false,
      oracleConfigured,
      oracleObservedInRange,
      categories: new Set<string>(),
      sampleUnpricedTransaction: null,
    };
    row.movementCount += 1;
    row.categories.add(movement.category);
    row.currentPriceCandidate ||= currentPriceCandidate;
    row.oracleConfigured ||= oracleConfigured;
    row.oracleObservedInRange ||= oracleObservedInRange;
    if (eventPriced) row.eventPricedCount += 1;
    else {
      row.unpricedEventCount += 1;
      row.sampleUnpricedTransaction ??= movement.transactionHash;
    }
    rows.set(id, row);
  }

  const tokensReport = [...rows.values()]
    .map((row) => ({ ...row, categories: [...row.categories].sort() }))
    .sort((left, right) => left.chainId - right.chainId || left.symbol.localeCompare(right.symbol));
  const eventPricedCount = tokensReport.reduce((total, row) => total + row.eventPricedCount, 0);
  const currentPriceCandidateCount = tokensReport.filter((row) => row.currentPriceCandidate).length;
  return {
    summary: {
      movementCount: movements.length,
      tokenCount: tokensReport.length,
      eventPricedCount,
      unpricedEventCount: movements.length - eventPricedCount,
      eventUsdCoveragePercent: percent(eventPricedCount, movements.length),
      tokensWithCurrentPriceCandidate: currentPriceCandidateCount,
      tokensWithoutCurrentPriceCandidate: tokensReport.length - currentPriceCandidateCount,
      currentPriceCandidateCoveragePercent: percent(currentPriceCandidateCount, tokensReport.length),
      allHistoricalEventsPriced: eventPricedCount === movements.length,
      allTokensHaveCurrentPriceCandidate: currentPriceCandidateCount === tokensReport.length,
    },
    tokens: tokensReport,
  };
}

const tokenId = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;
const percent = (covered: number, total: number) => (total ? Number(((covered / total) * 100).toFixed(2)) : 100);
