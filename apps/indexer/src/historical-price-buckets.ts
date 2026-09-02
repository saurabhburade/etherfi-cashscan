import historicalPriceBuckets from "./historical-price-buckets.json" with { type: "json" };

type HistoricalPriceRoute = {
  asset: string;
  validFrom: string;
  validUntilExclusive: string;
  source: string;
  sourceKeys: string[];
  priceRouteRef?: string;
  sourceKeyByBucketId?: Record<string, string>;
  pricesByBucketId?: Record<string, string>;
};

type HistoricalPriceSource = {
  chainId: number;
  pair: string;
  address: string;
  proxyAddress: string;
};

const constants = historicalPriceBuckets as {
  bucketSeconds: number;
  sources: Record<string, HistoricalPriceSource>;
  routes: Record<string, HistoricalPriceRoute>;
};

export type HistoricalPriceMatch = {
  asset: string;
  bucketId: string;
  bucketStart: Date;
  bucketEnd: Date;
  priceUsdE18: bigint;
  source: string;
  sourceChainId: number;
  sourceAddresses: string[];
  sourceIdentifier: string;
};

/**
 * Resolve a checked-in 15-minute snapshot with one direct object lookup.
 * Buckets contain the latest verified oracle value available at bucket start,
 * so an event can never inherit a future observation from its own bucket.
 */
export function historicalPriceAt(
  chainId: number,
  tokenAddress: string,
  timestamp: number | bigint,
): HistoricalPriceMatch | null {
  const routeId = `${chainId}:${tokenAddress.toLowerCase()}`;
  const route = constants.routes[routeId];
  if (!route) return null;

  const timestampSeconds = BigInt(timestamp);
  const validFrom = BigInt(Math.floor(Date.parse(route.validFrom) / 1000));
  const validUntil = BigInt(Math.floor(Date.parse(route.validUntilExclusive) / 1000));
  if (timestampSeconds < validFrom || timestampSeconds >= validUntil) return null;

  const bucketSeconds = BigInt(constants.bucketSeconds);
  const bucketId = (timestampSeconds / bucketSeconds).toString();
  const priceRoute = route.priceRouteRef ? constants.routes[route.priceRouteRef] : route;
  if (!priceRoute?.pricesByBucketId) return null;
  const rawPrice = priceRoute.pricesByBucketId[bucketId];
  if (rawPrice === undefined) return null;
  const priceUsdE18 = BigInt(rawPrice);
  if (priceUsdE18 <= 0n) return null;

  const bucketSourceKey = priceRoute.sourceKeyByBucketId?.[bucketId];
  const sourceKeys = bucketSourceKey ? [bucketSourceKey] : priceRoute.sourceKeys;
  const routeSources = sourceKeys.map((key) => constants.sources[key]).filter(Boolean);
  if (routeSources.length !== sourceKeys.length) return null;
  const bucketStartSeconds = BigInt(bucketId) * bucketSeconds;
  return {
    asset: route.asset,
    bucketId,
    bucketStart: new Date(Number(bucketStartSeconds) * 1000),
    bucketEnd: new Date(Number(bucketStartSeconds + bucketSeconds) * 1000),
    priceUsdE18,
    source: bucketSourceKey ?? priceRoute.source,
    sourceChainId: routeSources[0].chainId,
    sourceAddresses: routeSources.map((source) => source.proxyAddress),
    sourceIdentifier: `historical-price-buckets.json#${routeId}:${bucketId}`,
  };
}

export function historicalPriceConstants() {
  return constants;
}
