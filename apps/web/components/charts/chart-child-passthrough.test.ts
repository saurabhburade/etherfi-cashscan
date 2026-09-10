import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChartLegend } from "./cartesian-axis";
import { isClipExcludedComponent } from "./chart-child-passthrough";

describe("chart child clip classification", () => {
  it("keeps the legend visible while series reveal animations replay", () => {
    const legend = createElement(ChartLegend, { items: [] });

    expect(isClipExcludedComponent(legend)).toBe(true);
  });
});
