export { zeroAddress as ZERO_ADDRESS } from "viem";

export function asBigInt(value: number | bigint | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export function eventId(chainId: number, transactionHash: string, logIndex: number): string {
  return `${chainId}:${transactionHash.toLowerCase()}:${logIndex}`;
}

export function accountId(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

export function dayFromUnixSeconds(value: number | bigint): string {
  return new Date(Number(value) * 1000).toISOString().slice(0, 10);
}

export function dailyMetricId(chainId: number, timestamp: number | bigint): string {
  return `${chainId}:${dayFromUnixSeconds(timestamp)}`;
}

export function hourFromUnixSeconds(value: number | bigint): number {
  return new Date(Number(value) * 1000).getUTCHours();
}

/** A stable, numeric 15-minute UTC interval identity for a Unix timestamp. */
export function fifteenMinuteBucketId(timestamp: number | bigint): bigint {
  return BigInt(timestamp) / 900n;
}

export function isFreshNonFuturePrice(eventTimestamp: number | bigint, sourceTimestamp: number | bigint): boolean {
  const eventSeconds = BigInt(eventTimestamp);
  const sourceSeconds = BigInt(sourceTimestamp);
  return sourceSeconds <= eventSeconds && eventSeconds - sourceSeconds <= 900n;
}

export function spendBucket(value: bigint, decimals = 6): { label: string; sortOrder: number } {
  const scale = 10n ** BigInt(decimals);
  if (value <= 5n * scale) return { label: "$1-$5", sortOrder: 0 };
  if (value <= 50n * scale) return { label: "$6-$50", sortOrder: 1 };
  if (value <= 200n * scale) return { label: "$51-$200", sortOrder: 2 };
  if (value <= 1_000n * scale) return { label: "$201-$1,000", sortOrder: 3 };
  if (value <= 5_000n * scale) return { label: "$1,001-$5,000", sortOrder: 4 };
  if (value <= 10_000n * scale) return { label: "$5,001-$10,000", sortOrder: 5 };
  return { label: ">$10,000", sortOrder: 6 };
}

export function bytes32Label(value: string): string {
  if (!value.startsWith("0x")) return value;
  const bytes = value.slice(2).match(/.{2}/g) ?? [];
  const chars: number[] = [];
  for (const byte of bytes) {
    const code = Number.parseInt(byte, 16);
    if (code === 0) break;
    if (code < 32 || code > 126) return value.toLowerCase();
    chars.push(code);
  }
  return chars.length ? String.fromCharCode(...chars) : value.toLowerCase();
}

export function rampKindFromLabel(label: string): "onramp" | "offramp" | "other" {
  const normalized = label.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  if (normalized.includes("ONRAMP")) return "onramp";
  if (normalized.includes("OFFRAMP")) return "offramp";
  return "other";
}

export function isEurRampToken(token: string): boolean {
  return token.toUpperCase().replaceAll(/[^A-Z0-9]/g, "") === "EURC";
}

export function rampAmountUsd(
  amountRaw: bigint,
  token: string,
  fxAnswer?: bigint,
  fxDecimals = 8,
): { amountUsd: bigint; fxStatus: "not_required" | "chainlink" | "unavailable" } {
  if (!isEurRampToken(token)) return { amountUsd: amountRaw, fxStatus: "not_required" };
  if (fxAnswer === undefined || fxAnswer <= 0n) return { amountUsd: 0n, fxStatus: "unavailable" };
  return {
    // amountRaw and amountUsd both retain the emitter's six-decimal scale.
    amountUsd: (amountRaw * fxAnswer) / 10n ** BigInt(fxDecimals),
    fxStatus: "chainlink",
  };
}

export function classifyMovement(fromTracked: boolean, toTracked: boolean): "internal" | "in" | "out" {
  if (fromTracked && toTracked) return "internal";
  return toTracked ? "in" : "out";
}

export function applyBalanceDelta(current: bigint, inflow: bigint, outflow: bigint): bigint {
  return current + inflow - outflow;
}

export function balanceChange(current: bigint, next: bigint): bigint {
  return next - current;
}

/**
 * Repayment events can include accrued interest and rounding, so their total
 * may legitimately exceed the originally emitted principal. Debt is a
 * liability and must never turn that excess into a negative asset.
 */
export function outstandingDebt(borrowed: bigint, repaid: bigint, liquidated = 0n): bigint {
  const remaining = borrowed - repaid - liquidated;
  return remaining > 0n ? remaining : 0n;
}

export function uniqueLowercase(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

export function impliedUsdPriceE18(amount: bigint, amountUsd: bigint, tokenDecimals: number, usdDecimals = 6): bigint {
  if (amount <= 0n || amountUsd < 0n) return 0n;
  const tokenScale = 10n ** BigInt(tokenDecimals);
  const usdScale = 10n ** BigInt(usdDecimals);
  return (amountUsd * tokenScale * 10n ** 18n) / (amount * usdScale);
}

/** Returns USD with the Cash emitter's six-decimal scale. */
export function amountAtPrice(amount: bigint, priceUsdE18: bigint, tokenDecimals: number): bigint {
  return (amount * priceUsdE18 * 1_000_000n) / (10n ** BigInt(tokenDecimals) * 10n ** 18n);
}

export function priceDeviationOverHalf(candidate: bigint, current: bigint): boolean {
  if (candidate <= 0n || current <= 0n) return false;
  const difference = candidate > current ? candidate - current : current - candidate;
  return difference * 2n > current;
}

export function isLaterTokenSpend(
  candidate: { timestamp: number | bigint; blockNumber: number | bigint; logIndex: number; id: string },
  current: { timestamp: number | bigint; blockNumber: number | bigint; logIndex: number; id: string },
): boolean {
  const candidateTimestamp = BigInt(candidate.timestamp);
  const currentTimestamp = BigInt(current.timestamp);
  if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp;
  const candidateBlock = BigInt(candidate.blockNumber);
  const currentBlock = BigInt(current.blockNumber);
  if (candidateBlock !== currentBlock) return candidateBlock > currentBlock;
  if (candidate.logIndex !== current.logIndex) return candidate.logIndex > current.logIndex;
  // The feed's final tie-breaker is id ASC, so the lexically smaller id wins.
  return candidate.id < current.id;
}
