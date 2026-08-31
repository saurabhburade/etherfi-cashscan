"use client";

import { useMemo } from "react";
import { useChartStable, useYScale } from "./chart-context";

export interface CartesianXAxisProps {
  /** Target number of readable labels, including the two edges. */
  numTicks?: number;
}

export interface CartesianYAxisProps {
  /** The scale group to label (matches a series' `yAxisId`). */
  yAxisId?: string | number;
  /** Formats the scale's numeric tick values. */
  tickFormatter: (value: number) => string;
  /** Number of grid-aligned tick labels. */
  numTicks?: number;
}

export interface ChartLegendProps {
  items: Array<{ color: string; label: string }>;
}

function evenlySpacedIndices(length: number, count: number): number[] {
  if (length <= 1) return length ? [0] : [];
  const last = length - 1;
  return [
    ...new Set(
      Array.from({ length: Math.min(count, length) }, (_, index) =>
        Math.round((index / (Math.min(count, length) - 1)) * last),
      ),
    ),
  ];
}

function dateFormatter(first: Date, last: Date): Intl.DateTimeFormat {
  const span = Math.abs(last.getTime() - first.getTime());
  if (span <= 48 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (first.getUTCFullYear() === last.getUTCFullYear() && span <= 370 * 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
}

/** SVG-native time/category labels, so chart exports retain their x-axis context. */
export function CartesianXAxis({ numTicks = 5 }: CartesianXAxisProps) {
  const { barScale, bandWidth, barXAccessor, data, dateLabels, innerHeight, innerWidth, xAccessor, xScale } =
    useChartStable();
  const ticks = useMemo(() => {
    const indices = evenlySpacedIndices(data.length, numTicks);
    const dates = data.map(xAccessor);
    const formatter = dates.length ? dateFormatter(dates[0]!, dates.at(-1)!) : null;
    return indices.map((index) => {
      const point = data[index]!;
      const category = barXAccessor?.(point);
      const barX = category && barScale ? (barScale(category) ?? 0) + (bandWidth ?? 0) / 2 : undefined;
      return {
        index,
        label: formatter ? formatter.format(dates[index]!) : (dateLabels[index] ?? ""),
        x: barX ?? xScale(dates[index]!),
      };
    });
  }, [bandWidth, barScale, barXAccessor, data, dateLabels, numTicks, xAccessor, xScale]);

  return (
    <g aria-hidden="true" className="chart-cartesian-x-axis" fill="var(--chart-label)" fontSize={11} opacity={0.62}>
      {ticks.map(({ index, label, x }) => (
        <text
          key={`${index}-${label}`}
          textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
          x={Math.max(0, Math.min(innerWidth, x))}
          y={innerHeight + 20}
        >
          {label}
        </text>
      ))}
    </g>
  );
}

/** SVG-native value labels that use the exact scale and ticks as the grid. */
export function CartesianYAxis({ yAxisId, tickFormatter, numTicks = 5 }: CartesianYAxisProps) {
  const yScale = useYScale(yAxisId);
  const ticks = useMemo(() => yScale.ticks?.(numTicks) ?? [], [numTicks, yScale]);
  return (
    <g
      aria-hidden="true"
      className="chart-cartesian-y-axis"
      fill="var(--chart-label)"
      fontSize={11}
      opacity={0.62}
      textAnchor="end"
    >
      {ticks.map((value) => (
        <text dominantBaseline="middle" key={value} x={-10} y={yScale(value)}>
          {tickFormatter(value)}
        </text>
      ))}
    </g>
  );
}

/** A compact SVG legend intended for the reserved bottom chart margin. */
export function ChartLegend({ items }: ChartLegendProps) {
  const { innerHeight } = useChartStable();
  return (
    <g
      aria-hidden="true"
      className="chart-svg-legend"
      fill="var(--chart-label)"
      fontSize={11}
      transform={`translate(0 ${innerHeight + 48})`}
    >
      {items.map((item, index) => {
        const x =
          index === 0
            ? 0
            : items.slice(0, index).reduce((offset, previous) => offset + previous.label.length * 6.1 + 30, 0);
        return (
          <g key={item.label} transform={`translate(${x} 0)`}>
            <rect fill={item.color} height={7} rx={2} width={7} y={-4.5} />
            <text dominantBaseline="middle" x={12}>
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
