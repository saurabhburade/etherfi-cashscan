import { describe, expect, it } from "vitest";
import { dailyTierSeries } from "../analytics-chart-data";

describe("daily tier rollup", () => {
  it("renders the supplied entries, exits, and net change without reclassifying transitions", () => {
    const series = dailyTierSeries([
      { day: "2026-09-02", entries: 2, exits: 1, netChange: 1 },
      { day: "2026-09-01", entries: 4, exits: 3, netChange: 1 },
    ]);

    expect(series).toEqual([
      { date: new Date("2026-09-01T00:00:00Z"), entries: 4, exits: 3, netChange: 1 },
      { date: new Date("2026-09-02T00:00:00Z"), entries: 2, exits: 1, netChange: 1 },
    ]);
  });

  it("caps dense daily rollups while preserving all three totals and the last date", () => {
    const rows = Array.from({ length: 241 }, (_, index) => ({
      day: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
      entries: 2,
      exits: 1,
      netChange: 1,
    }));
    const series = dailyTierSeries(rows, 30);

    expect(series).toHaveLength(30);
    expect(series.reduce((total, row) => total + row.entries, 0)).toBe(482);
    expect(series.reduce((total, row) => total + row.exits, 0)).toBe(241);
    expect(series.reduce((total, row) => total + row.netChange, 0)).toBe(241);
  });
});
