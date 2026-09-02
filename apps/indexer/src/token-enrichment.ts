/**
 * Token metadata is deliberately local to the indexer. Handler-time RPC calls
 * make the same log produce different data across retries/reorgs, and external
 * feed-directory lookups are not canonical chain history.
 *
 * Add verified entries here when a token needs display metadata. Unknown tokens
 * remain indexable with an explicit 18-decimal display fallback; their USD
 * price is intentionally zero until an event-backed price source exists.
 */
type TokenMetadata = { name: string; symbol: string; decimals: number };

const TOKEN_REGISTRY: Readonly<Record<number, Readonly<Record<string, TokenMetadata>>>> = {
  // Frozen from the verified metadata in the existing production index. This
  // preserves deterministic display units through a fresh event-only reindex.
  [CHAIN_IDS.optimism]: {
    "0xa519afbc91986c0e7501d7e34968fee51cd901ac": { name: "hyperbeat x ether.fi HYPE", symbol: "beHYPE", decimals: 18 },
    "0x657e8c867d8b37dcc18fa4caead9c45eb088c642": { name: "ether.fi BTC", symbol: "eBTC", decimals: 8 },
    "0xe0080d2f853ecddbd81a643dc10da075df26fd3f": { name: "ether.fi governance token", symbol: "ETHFI", decimals: 18 },
    "0xdcb612005417dc906ff72c87df732e5a90d49e11": { name: "EURC", symbol: "EURC", decimals: 6 },
    "0x939778d83b46b456224a33fb59630b11dec56663": { name: "EtherFi USD", symbol: "eUSD", decimals: 18 },
    "0x80eede496655fb9047dd39d9f418d5483ed600df": { name: "Frax USD", symbol: "frxUSD", decimals: 18 },
    "0x5f46d540b6ed704c3c8789105f30e075aa900726": { name: "Ether.Fi Liquid BTC", symbol: "liquidBTC", decimals: 8 },
    "0xf0bb20865277abd641a307ece5ee04e79073416c": { name: "Ether.Fi Liquid ETH", symbol: "liquidETH", decimals: 18 },
    "0xca5921df65e2e1b0b98ae91c0187ba80d4124898": {
      name: "Ether.Fi Liquid Reserve",
      symbol: "liquidRESERVE",
      decimals: 18,
    },
    "0xe5d3854736e0d513aae2d8d708ad94d14fd56a6a": {
      name: "Ether.Fi Liquid Reserve",
      symbol: "liquidRESERVE",
      decimals: 18,
    },
    "0x08c6f91e2b681faf5e17227f2a44c307b3c1364c": { name: "Ether.Fi Liquid USD", symbol: "liquidUSD", decimals: 6 },
    "0x86b5780b606940eb59a062aa85a07959518c0161": { name: "Staked ETHFI", symbol: "sETHFI", decimals: 18 },
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { name: "USD Coin", symbol: "USDC", decimals: 6 },
    "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": { name: "Tether USD", symbol: "USDT", decimals: 6 },
    "0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff": { name: "Wrapped eETH", symbol: "weETH", decimals: 18 },
    "0xcc476b1a49bcdf5192561e87b6fb8ea78aa28c13": { name: "Liquid Euro", symbol: "weEUR", decimals: 18 },
    "0x4200000000000000000000000000000000000006": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
    "0xd83e3d560ba6f05094d9d8b3eb8aaea571d1864e": { name: "Wrapped HYPE", symbol: "WHYPE", decimals: 18 },
  },
  [CHAIN_IDS.scroll]: {
    "0xd29687c813d741e2f938f4ac377128810e217b1b": { name: "Scroll", symbol: "SCR", decimals: 18 },
    "0xa519afbc91986c0e7501d7e34968fee51cd901ac": { name: "hyperbeat x ether.fi HYPE", symbol: "beHYPE", decimals: 18 },
    "0x657e8c867d8b37dcc18fa4caead9c45eb088c642": { name: "ether.fi BTC", symbol: "eBTC", decimals: 8 },
    "0x056a5fa5da84ceb7f93d36e545c5905607d8bd81": { name: "ether.fi governance token", symbol: "ETHFI", decimals: 18 },
    "0xdcb612005417dc906ff72c87df732e5a90d49e11": { name: "EURC", symbol: "EURC", decimals: 6 },
    "0x939778d83b46b456224a33fb59630b11dec56663": { name: "ether.fi USD", symbol: "eUSD", decimals: 18 },
    "0x397f939c3b91a74c321ea7129396492ba9cdce82": { name: "Frax USD", symbol: "frxUSD", decimals: 18 },
    "0x5f46d540b6ed704c3c8789105f30e075aa900726": { name: "Ether.Fi Liquid BTC", symbol: "liquidBTC", decimals: 8 },
    "0xf0bb20865277abd641a307ece5ee04e79073416c": { name: "Ether.Fi Liquid ETH", symbol: "liquidETH", decimals: 18 },
    "0xb7fb3768caac98354eadf514b48f28f2fe822bf0": {
      name: "Ether.Fi Liquid Reserve",
      symbol: "liquidRESERVE",
      decimals: 18,
    },
    "0x08c6f91e2b681faf5e17227f2a44c307b3c1364c": { name: "Ether.Fi Liquid USD", symbol: "liquidUSD", decimals: 6 },
    "0x86b5780b606940eb59a062aa85a07959518c0161": { name: "Staked ETHFI", symbol: "sETHFI", decimals: 18 },
    "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4": { name: "USD Coin", symbol: "USDC", decimals: 6 },
    "0xf55bec9cafdbe8730f096aa55dad6d22d44099df": { name: "Tether USD", symbol: "USDT", decimals: 6 },
    "0x01f0a31698c4d065659b9bdc21b3610292a1c506": { name: "Wrapped eETH", symbol: "weETH", decimals: 18 },
    "0xca0bfd5f735924e34cc567146989e467ffbbce1a": { name: "Wrapped eETH", symbol: "weETH", decimals: 18 },
    "0x5300000000000000000000000000000000000004": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
    "0xd83e3d560ba6f05094d9d8b3eb8aaea571d1864e": { name: "Wrapped HYPE", symbol: "wHYPE", decimals: 18 },
  },
};

const SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  "USDC.E": "USDC",
  WBTC: "BTC",
  WETH: "ETH",
};

export function canonicalOracleSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  return SYMBOL_ALIASES[normalized] ?? normalized;
}

export type VerifiedCrossChainPricePeer = {
  chainId: number;
  tokenAddress: string;
  canonicalAsset: string;
  decimals: number;
};

/**
 * Resolve the shared asset identity only when the exact token address is in
 * the checked-in registry and another configured Cash chain has the same
 * canonical asset. Runtime ERC-20 symbols never participate in this mapping.
 */
export function verifiedCanonicalPriceAsset(chainId: number, tokenAddress: string): string | null {
  const local = TOKEN_REGISTRY[chainId]?.[tokenAddress.toLowerCase()];
  if (!local) return null;
  const canonicalAsset = canonicalOracleSymbol(local.symbol);
  return Object.entries(TOKEN_REGISTRY).some(
    ([candidateChainId, tokens]) =>
      Number(candidateChainId) !== chainId &&
      Object.values(tokens).some((metadata) => canonicalOracleSymbol(metadata.symbol) === canonicalAsset),
  )
    ? canonicalAsset
    : null;
}

/**
 * Resolve cross-chain price peers from the checked-in registry only. Runtime
 * ERC-20 symbols are intentionally excluded because a token can spoof another
 * asset's symbol and inherit an unrelated USD price.
 */
export function verifiedCrossChainPricePeers(chainId: number, tokenAddress: string): VerifiedCrossChainPricePeer[] {
  const local = TOKEN_REGISTRY[chainId]?.[tokenAddress.toLowerCase()];
  if (!local) return [];
  const canonicalAsset = verifiedCanonicalPriceAsset(chainId, tokenAddress);
  if (!canonicalAsset) return [];
  return Object.entries(TOKEN_REGISTRY)
    .flatMap(([candidateChainId, tokens]) =>
      Number(candidateChainId) === chainId
        ? []
        : Object.entries(tokens)
            .filter(([, metadata]) => canonicalOracleSymbol(metadata.symbol) === canonicalAsset)
            .map(([candidateAddress, metadata]) => ({
              chainId: Number(candidateChainId),
              tokenAddress: candidateAddress,
              canonicalAsset,
              decimals: metadata.decimals,
            })),
    )
    .sort((a, b) => a.chainId - b.chainId || a.tokenAddress.localeCompare(b.tokenAddress));
}

export function tokenPriceBucketId(chainId: number, tokenAddress: string, bucketStart: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}:${bucketStart}`;
}

/**
 * Identity for a shared price bucket. The canonical asset must come from the
 * checked-in registry rather than untrusted runtime token metadata.
 */
export function canonicalAssetPriceBucketId(canonicalAsset: string, bucketId: bigint): string {
  return `${canonicalAsset}:${bucketId}`;
}

type FeedDirectoryRow = {
  name?: string;
  proxyAddress?: string;
  docs?: { baseAsset?: string; quoteAsset?: string; attributeType?: string };
};

// Pure compatibility helper retained for callers/tests; it performs no lookup.
export function findDirectUsdFeed(rows: readonly FeedDirectoryRow[], symbol: string): FeedDirectoryRow | undefined {
  const base = canonicalOracleSymbol(symbol);
  return rows.find(
    (row) =>
      row.proxyAddress &&
      row.docs?.baseAsset?.toUpperCase() === base &&
      row.docs?.quoteAsset?.toUpperCase() === "USD" &&
      row.docs?.attributeType !== "exchange_rate",
  );
}

export function tokenFromRegistry(chainId: number, address: string) {
  const normalized = address.toLowerCase();
  const known = TOKEN_REGISTRY[chainId]?.[normalized];
  const fallback = known ?? {
    name: "Unverified token",
    symbol: `TOKEN-${normalized.slice(2, 8).toUpperCase()}`,
    // Presentation fallback only; never use it to derive USD.
    decimals: 18,
  };
  return {
    ...fallback,
    decimalsVerified: Boolean(known),
    totalSupply: 0n,
    metadataStatus: known ? "static_verified" : "fallback_unverified",
    oracleAddress: zeroAddress,
    oraclePair: "",
    oracleDecimals: 0,
    oracleHeartbeat: 0,
    oracleDiscovery: "event_only_unavailable",
    price: 0n,
    priceUpdatedAt: 0n,
  };
}

import { CHAIN_IDS } from "@etherfi/contracts";
import { zeroAddress } from "viem";
