import { describe, expect, it } from "vitest";
import { aggregateOverviewPoints, type OverviewPoint } from "./analytics-chart-data";

const point = (index: number): OverviewPoint => ({
  day: `2026-01-${String(index + 1).padStart(2, "0")}`,
  date: new Date(Date.UTC(2026, 0, index + 1)),
  spendUsd: index + 1,
  transactions: index + 2,
  activeCards: 100 + index,
  newCards: 1,
  topUps: index,
  cashbackUsd: index / 10,
  onrampUsd: index + 3,
  offrampUsd: index + 4,
  borrowedUsd: index + 5,
  repaidUsd: index + 6,
  cumulativeSpendUsd: index + 1,
  cumulativeTransactions: index + 2,
  cumulativeCards: 100 + index,
  cumulativeCashbackUsd: index / 10,
});

describe("overview chart aggregation", () => {
  it("preserves flow totals while keeping the last stock and cumulative values in each bucket", () => {
    const rows = Array.from({ length: 5 }, (_, index) => point(index));
    const aggregated = aggregateOverviewPoints(rows, 2);

    expect(aggregated).toHaveLength(2);
    expect(aggregated.map((row) => row.spendUsd)).toEqual([6, 9]);
    expect(aggregated.map((row) => row.transactions)).toEqual([9, 11]);
    expect(aggregated.map((row) => row.newCards)).toEqual([3, 2]);
    expect(aggregated.map((row) => row.topUps)).toEqual([3, 7]);
    expect(aggregated.map((row) => row.activeCards)).toEqual([102, 104]);
    expect(aggregated.map((row) => row.cumulativeSpendUsd)).toEqual([3, 5]);
    expect(aggregated.map((row) => row.day)).toEqual(["2026-01-03", "2026-01-05"]);
  });

  it("enforces the point cap without dropping any flow metrics", () => {
    const rows = Array.from({ length: 731 }, (_, index) => ({
      ...point(index % 28),
      day: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      date: new Date(Date.UTC(2026, 0, index + 1)),
      activeCards: index,
      cumulativeSpendUsd: index,
    }));
    const aggregated = aggregateOverviewPoints(rows, 120);

    expect(aggregated.length).toBeLessThanOrEqual(120);
    expect(aggregated.reduce((total, row) => total + row.spendUsd, 0)).toBe(
      rows.reduce((total, row) => total + row.spendUsd, 0),
    );
    expect(aggregated.reduce((total, row) => total + row.transactions, 0)).toBe(
      rows.reduce((total, row) => total + row.transactions, 0),
    );
    expect(aggregated.at(-1)).toMatchObject({
      activeCards: rows.at(-1)?.activeCards,
      cumulativeSpendUsd: rows.at(-1)?.cumulativeSpendUsd,
    });
  });
});
