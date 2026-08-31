import { CHAIN_IDS } from "@etherfi/contracts";
import { type Address, createEffect, S } from "envio";
import { createPublicClient, decodeAbiParameters, type Hex, hexToString, http, type PublicClient } from "viem";

import { tokenFromRegistry } from "./token-enrichment.js";

const SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
} as const satisfies Record<string, Hex>;

const clients = new Map<number, PublicClient>();

export const erc20MetadataEffect = createEffect(
  {
    name: "erc20_metadata_v1",
    input: { address: S.address },
    output: {
      name: S.string,
      symbol: S.string,
      decimals: S.int32,
      decimalsVerified: S.boolean,
      metadataStatus: S.string,
    },
    // Cache identity is (chain, token address), so every token is queried at
    // most once during a reindex and concurrent observations are deduplicated.
    cache: true,
    crossChain: false,
    rateLimit: { calls: 20, per: "second" },
  },
  async ({ input, context }) => {
    const fallback = tokenFromRegistry(context.chain.id, input.address);
    const client = clientFor(context.chain.id);
    if (!client) return fallbackMetadata(fallback);

    const [name, symbol, decimals] = await Promise.all([
      readText(client, input.address, SELECTORS.name),
      readText(client, input.address, SELECTORS.symbol),
      readDecimals(client, input.address),
    ]);
    const resolvedName = name ?? fallback.name;
    const resolvedSymbol = symbol ?? fallback.symbol;
    const decimalsVerified = decimals !== null;
    const resolvedCount = Number(name !== null) + Number(symbol !== null) + Number(decimalsVerified);

    return {
      name: resolvedName,
      symbol: resolvedSymbol,
      decimals: decimals ?? fallback.decimals,
      decimalsVerified,
      metadataStatus: resolvedCount === 3 ? "rpc_resolved" : resolvedCount > 0 ? "rpc_partial" : "fallback_unverified",
    };
  },
);

function clientFor(chainId: number): PublicClient | null {
  const existing = clients.get(chainId);
  if (existing) return existing;
  const rpcUrl = rpcUrlFor(chainId);
  if (!rpcUrl) return null;
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 3, timeout: 12_000 }) });
  clients.set(chainId, client);
  return client;
}

function rpcUrlFor(chainId: number) {
  if (chainId === CHAIN_IDS.optimism) {
    return process.env.OPTIMISM_RPC_URL ?? "https://optimism-rpc.publicnode.com";
  }
  if (chainId === CHAIN_IDS.scroll) return process.env.SCROLL_RPC_URL ?? "https://scroll-rpc.publicnode.com";
  return null;
}

async function readText(client: PublicClient, address: Address, selector: Hex): Promise<string | null> {
  try {
    const result = await client.call({ to: address, data: selector });
    return result.data ? decodeErc20Text(result.data) : null;
  } catch {
    return null;
  }
}

async function readDecimals(client: PublicClient, address: Address): Promise<number | null> {
  try {
    const result = await client.call({ to: address, data: SELECTORS.decimals });
    if (!result.data) return null;
    const value = BigInt(result.data);
    return value >= 0n && value <= 255n ? Number(value) : null;
  } catch {
    return null;
  }
}

export function decodeErc20Text(data: Hex): string | null {
  let decoded: string | null = null;
  try {
    decoded = decodeAbiParameters([{ type: "string" }], data)[0];
  } catch {
    // Some older ERC-20s return bytes32 for name/symbol despite the standard
    // string ABI. Decode that representation before using a fallback label.
    if (data.length === 66) {
      try {
        decoded = hexToString(data, { size: 32 });
      } catch {
        decoded = null;
      }
    }
  }
  if (decoded === null) return null;
  const clean = decoded.replaceAll("\0", "").trim();
  return clean && clean.length <= 256 && /^[\x20-\x7E]+$/.test(clean) ? clean : null;
}

function fallbackMetadata(fallback: ReturnType<typeof tokenFromRegistry>) {
  return {
    name: fallback.name,
    symbol: fallback.symbol,
    decimals: fallback.decimals,
    decimalsVerified: fallback.decimalsVerified,
    metadataStatus: fallback.metadataStatus,
  };
}
