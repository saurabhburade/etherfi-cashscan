import { CHAIN_IDS } from "@etherfi/contracts";
import { type Address, createPublicClient, http, parseAbi, zeroAddress } from "viem";
import { optimism, scroll } from "viem/chains";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export type TokenOracle = {
  chainId: number;
  address: string;
  oracleAddress: string;
  oracleDecimals: number;
  oracleHeartbeat: number;
  price: string;
  priceUpdatedAt: string;
};

export type CurrentTokenPrice = { answer: bigint; decimals: number; updatedAt: bigint };

const clients = {
  [CHAIN_IDS.optimism]: createPublicClient({
    chain: optimism,
    batch: { multicall: true },
    transport: http(process.env.OPTIMISM_RPC_URL ?? "https://optimism-rpc.publicnode.com"),
  }),
  [CHAIN_IDS.scroll]: createPublicClient({
    chain: scroll,
    batch: { multicall: true },
    transport: http(process.env.SCROLL_RPC_URL ?? "https://scroll-rpc.publicnode.com"),
  }),
} as const;
const SUPPORTED_PRICE_CHAIN_IDS = [CHAIN_IDS.optimism, CHAIN_IDS.scroll] as const;

function fresh(answer: bigint, updatedAt: bigint, heartbeat: number, now: bigint) {
  const maximumAge = BigInt(Math.max(heartbeat > 0 ? heartbeat * 2 : 86_400, 300));
  return answer > 0n && updatedAt > 0n && updatedAt <= now + 60n && now - updatedAt <= maximumAge;
}

export async function currentTokenPrices(tokens: TokenOracle[]): Promise<Map<string, CurrentTokenPrice>> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const result = new Map<string, CurrentTokenPrice>();
  const uniqueFeeds = [
    ...new Map(
      tokens
        .filter((token) => token.oracleAddress && token.oracleAddress !== zeroAddress)
        .map((token) => [`${token.chainId}:${token.oracleAddress.toLowerCase()}`, token]),
    ).values(),
  ];
  const feedsByChainId = new Map<number, TokenOracle[]>();
  for (const token of uniqueFeeds) {
    const feeds = feedsByChainId.get(token.chainId);
    if (feeds) feeds.push(token);
    else feedsByChainId.set(token.chainId, [token]);
  }

  await Promise.all(
    SUPPORTED_PRICE_CHAIN_IDS.map(async (chainId) => {
      const feeds = feedsByChainId.get(chainId) ?? [];
      if (!feeds.length) return;
      try {
        const calls = await clients[chainId].multicall({
          allowFailure: true,
          contracts: feeds.map((token) => ({
            address: token.oracleAddress as Address,
            abi: feedAbi,
            functionName: "latestRoundData" as const,
          })),
        });
        for (let index = 0; index < feeds.length; index += 1) {
          const token = feeds[index];
          const call = calls[index];
          if (!token || call?.status !== "success") continue;
          const answer = call.result[1];
          const updatedAt = call.result[3];
          if (fresh(answer, updatedAt, token.oracleHeartbeat, now)) {
            result.set(`${token.chainId}:${token.address.toLowerCase()}`, {
              answer,
              decimals: token.oracleDecimals,
              updatedAt,
            });
          }
        }
      } catch {
        // The indexed snapshot below is a bounded fallback when an RPC is temporarily unavailable.
      }
    }),
  );

  for (const token of tokens) {
    const key = `${token.chainId}:${token.address.toLowerCase()}`;
    if (result.has(key)) continue;
    const answer = BigInt(token.price || "0");
    const updatedAt = BigInt(token.priceUpdatedAt || "0");
    if (fresh(answer, updatedAt, token.oracleHeartbeat, now)) {
      result.set(key, { answer, decimals: token.oracleDecimals, updatedAt });
    }
  }
  return result;
}
