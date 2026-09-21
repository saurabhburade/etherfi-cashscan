import type { DailyAnalytics } from "../lib/envio";

export const MAX_OVERVIEW_POINTS = 120;
export type OverviewPoint = DailyAnalytics & { cumulativeCashbackUsd: number; date: Date };

const OVERVIEW_FLOW_KEYS = [
  "spendUsd",
  "transactions",
  "newCards",
  "topUps",
  "cashbackUsd",
  "onrampUsd",
  "offrampUsd",
  "borrowedUsd",
  "repaidUsd",
] as const satisfies ReadonlyArray<keyof DailyAnalytics>;

export function aggregateOverviewPoints(points: OverviewPoint[], maxPoints = MAX_OVERVIEW_POINTS): OverviewPoint[] {
  if (maxPoints < 1) throw new Error("maxPoints must be at least 1");
  const orderedPoints = [...points].sort((left, right) => left.date.getTime() - right.date.getTime());
  if (orderedPoints.length <= maxPoints) return orderedPoints;

  const bucketCount = Math.min(maxPoints, orderedPoints.length);
  const buckets = Array.from({ length: bucketCount }, () => [] as OverviewPoint[]);
  orderedPoints.forEach((point, index) => {
    buckets[Math.floor((index * bucketCount) / orderedPoints.length)]?.push(point);
  });

  return buckets
    .filter((bucket) => bucket.length > 0)
    .map((bucket) => {
      const last = bucket[bucket.length - 1];
      const aggregated = { ...last };
      for (const key of OVERVIEW_FLOW_KEYS) {
        aggregated[key] = bucket.reduce((total, point) => total + point[key], 0);
      }
      return aggregated;
    });
}

export type TierDailyPoint = { day: string; entries: number; exits: number; netChange: number };
export const MAX_TIER_DAILY_POINTS = 120;

const numeric = (input: unknown) => {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function dailyTierSeries(rows: TierDailyPoint[], maxPoints = MAX_TIER_DAILY_POINTS) {
  if (maxPoints < 1) throw new Error("maxPoints must be at least 1");
  const ordered = rows
    .filter((row) => Boolean(row.day))
    .map((row) => ({ ...row, date: new Date(`${row.day}T00:00:00Z`) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (ordered.length <= maxPoints) {
    return ordered.map((row) => ({
      date: row.date,
      entries: numeric(row.entries),
      exits: numeric(row.exits),
      netChange: numeric(row.netChange),
    }));
  }

  const bucketCount = Math.min(maxPoints, ordered.length);
  const buckets = Array.from({ length: bucketCount }, () => [] as typeof ordered);
  ordered.forEach((row, index) => {
    buckets[Math.floor((index * bucketCount) / ordered.length)]?.push(row);
  });
  return buckets
    .filter((bucket) => bucket.length > 0)
    .map((bucket) => {
      const last = bucket[bucket.length - 1];
      return {
        date: last.date,
        entries: bucket.reduce((total, row) => total + numeric(row.entries), 0),
        exits: bucket.reduce((total, row) => total + numeric(row.exits), 0),
        netChange: bucket.reduce((total, row) => total + numeric(row.netChange), 0),
      };
    });
}
