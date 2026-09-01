import type { EventCursor } from "./types.js";

export const normalizeAddress = (value: string) => value.toLowerCase();
export const canonicalEventId = (chainId: number, transactionHash: string, logIndex: number) =>
  `${chainId}:${transactionHash.toLowerCase()}:${logIndex}`;
export const accountTokenId = (chainId: number, account: string, token: string) =>
  `${chainId}:${normalizeAddress(account)}:${normalizeAddress(token)}`;
export const tokenId = (chainId: number, token: string) => `${chainId}:${normalizeAddress(token)}`;

/** Canonical GraphQL feed ordering: timestamp DESC, chain ASC, block DESC, log DESC, id ASC. */
export function compareGlobalOrder(a: EventCursor, b: EventCursor): number {
  if (a.timestamp !== b.timestamp) return a.timestamp > b.timestamp ? -1 : 1;
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (BigInt(a.blockNumber) !== BigInt(b.blockNumber)) return BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1;
  if (a.logIndex !== b.logIndex) return b.logIndex - a.logIndex;
  return a.id.localeCompare(b.id);
}
