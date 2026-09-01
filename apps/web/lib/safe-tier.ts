export const SAFE_TIER_NAMES = {
  0: "core",
  1: "luxe",
  2: "pinnacle",
  3: "vip",
  4: "business",
} as const;

export type SafeTierName = (typeof SAFE_TIER_NAMES)[keyof typeof SAFE_TIER_NAMES];
export type SafeTierCount = { tierId: number; safeCount: number };

const SAFE_TIER_IMAGE_URLS: Record<SafeTierName, string> = {
  core: "https://www.ether.fi/assets/core.avif",
  luxe: "https://www.ether.fi/assets/luxe.avif",
  pinnacle: "https://www.ether.fi/assets/pinnacle.avif",
  vip: "https://www.ether.fi/assets/vip.avif",
  business: "https://www.ether.fi/assets/business/cards-section-mobile.avif",
};

export function safeTierName(tierId: number | null | undefined): SafeTierName {
  return SAFE_TIER_NAMES[tierId as keyof typeof SAFE_TIER_NAMES] ?? "core";
}

export function safeTierImageUrl(tierId: number | null | undefined) {
  return SAFE_TIER_IMAGE_URLS[safeTierName(tierId)];
}

export function effectiveTierCounts(rows: SafeTierCount[], totalSafeCount: number): SafeTierCount[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (!(row.tierId in SAFE_TIER_NAMES) || row.safeCount <= 0) continue;
    counts.set(row.tierId, (counts.get(row.tierId) ?? 0) + row.safeCount);
  }

  const assignedSafeCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const unassignedSafeCount = Math.max(0, Math.trunc(totalSafeCount) - assignedSafeCount);
  if (unassignedSafeCount > 0) counts.set(0, (counts.get(0) ?? 0) + unassignedSafeCount);

  return [...counts.entries()]
    .map(([tierId, safeCount]) => ({ tierId, safeCount }))
    .sort((a, b) => a.tierId - b.tierId);
}
