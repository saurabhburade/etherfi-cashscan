export type PriceSource = "event_implied" | "chainlink" | "price_provider";
export type PriceObservation = {
  id: string;
  chainId: number;
  tokenAddress: string;
  source: PriceSource;
  priceUsdE18: bigint;
  observedAt: string;
  blockNumber: string | null;
  finalized: boolean;
  usage?: "historical" | "current";
  sourcePayload?: Record<string, unknown>;
};
export type CurrentPrice = {
  chainId: number;
  tokenAddress: string;
  priceUsdE18: bigint;
  source: PriceSource;
  observedAt: string;
  expiresAt: string;
};
export type PriceCandidate = PriceObservation & { verified: boolean; verificationReason: string | null };
export type PriceState = {
  observations: PriceObservation[];
  current: Map<string, CurrentPrice>;
  candidates: PriceCandidate[];
};
export const PRICE_TTL_MS = 15 * 60_000;
export const REFRESH_AFTER_MS = 5 * 60_000;
export const CANDIDATE_DEVIATION_BPS = 5_000;
export const priceKey = (chainId: number, token: string) => `${chainId}:${token.toLowerCase()}`;

export function normalizeEventImpliedPrice(
  amountRaw: bigint,
  amountUsdRaw: bigint,
  tokenDecimals: number,
  usdDecimals = 6,
): bigint | null {
  if (
    !Number.isInteger(tokenDecimals) ||
    tokenDecimals < 0 ||
    tokenDecimals > 255 ||
    amountRaw <= 0n ||
    amountUsdRaw < 0n
  )
    return null;
  return (amountUsdRaw * 10n ** BigInt(tokenDecimals) * 10n ** 18n) / (amountRaw * 10n ** BigInt(usdDecimals));
}
export function needsRefresh(current: CurrentPrice | undefined, now: Date): boolean {
  return !current || now.getTime() - Date.parse(current.observedAt) >= REFRESH_AFTER_MS;
}
export function isFresh(current: CurrentPrice | undefined, at: Date): boolean {
  return !!current && Date.parse(current.expiresAt) > at.getTime();
}
export function deviationBps(left: bigint, right: bigint): bigint {
  if (left <= 0n || right <= 0n) return 10_000n;
  return (abs(left - right) * 10_000n) / right;
}
const abs = (v: bigint) => (v < 0n ? -v : v);

/** Never returns a current cache row for historical valuation. */
export function historicalPrice(
  observations: PriceObservation[],
  chainId: number,
  token: string,
  at: Date,
  finalizedBlock: string | null,
): PriceObservation | null {
  const allowed = observations.filter(
    (row) =>
      row.chainId === chainId &&
      row.tokenAddress.toLowerCase() === token.toLowerCase() &&
      row.finalized &&
      Date.parse(row.observedAt) <= at.getTime() &&
      (finalizedBlock == null || row.blockNumber == null || BigInt(row.blockNumber) <= BigInt(finalizedBlock)),
  );
  const precedence: PriceSource[] = ["event_implied", "chainlink", "price_provider"];
  for (const source of precedence) {
    const rows = allowed
      .filter((row) => row.source === source)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
    if (rows[0]) return rows[0];
  }
  return null;
}

export function applyObservation(
  state: PriceState,
  observation: PriceObservation,
  now = new Date(observation.observedAt),
): { state: PriceState; accepted: boolean } {
  const key = priceKey(observation.chainId, observation.tokenAddress);
  const existing = state.current.get(key);
  const candidate = existing && deviationBps(observation.priceUsdE18, existing.priceUsdE18) > CANDIDATE_DEVIATION_BPS;
  const next: PriceState = {
    observations: [...state.observations, observation],
    current: new Map(state.current),
    candidates: [...state.candidates],
  };
  if (candidate) {
    next.candidates.push({ ...observation, verified: false, verificationReason: "deviation_gt_50_percent" });
    return { state: next, accepted: false };
  }
  next.current.set(key, {
    chainId: observation.chainId,
    tokenAddress: observation.tokenAddress.toLowerCase(),
    priceUsdE18: observation.priceUsdE18,
    source: observation.source,
    observedAt: observation.observedAt,
    expiresAt: new Date(now.getTime() + PRICE_TTL_MS).toISOString(),
  });
  return { state: next, accepted: true };
}

export function verifyCandidate(state: PriceState, candidateId: string, corroboratingPrice: bigint): PriceState {
  const candidates = state.candidates.map((candidate) =>
    candidate.id === candidateId
      ? {
          ...candidate,
          verified: deviationBps(candidate.priceUsdE18, corroboratingPrice) <= CANDIDATE_DEVIATION_BPS,
          verificationReason:
            deviationBps(candidate.priceUsdE18, corroboratingPrice) <= CANDIDATE_DEVIATION_BPS
              ? "corroborated"
              : "not_corroborated",
        }
      : candidate,
  );
  const candidate = candidates.find((row) => row.id === candidateId);
  const current = new Map(state.current);
  if (candidate?.verified)
    current.set(priceKey(candidate.chainId, candidate.tokenAddress), {
      chainId: candidate.chainId,
      tokenAddress: candidate.tokenAddress.toLowerCase(),
      priceUsdE18: candidate.priceUsdE18,
      source: candidate.source,
      observedAt: candidate.observedAt,
      expiresAt: new Date(Date.parse(candidate.observedAt) + PRICE_TTL_MS).toISOString(),
    });
  return { ...state, current, candidates };
}
