"use client";

import { memo, useMemo } from "react";
import { useChart } from "./chart-context";

export interface BarXAxisProps {
  /** Width of the date ticker box for fade calculation. Default: 50 */
  tickerHalfWidth?: number;
  /** Whether to show all labels or skip some for dense data. Default: false */
  showAllLabels?: boolean;
  /** Maximum number of labels to show. Default: 12 */
  maxLabels?: number;
}

function tickOpacity(x: number, crosshairX: number | null, tickerHalfWidth: number) {
  const fadeBuffer = 20;
  const fadeRadius = tickerHalfWidth + fadeBuffer;
  if (crosshairX === null) return 1;
  const distance = Math.abs(x - crosshairX);
  if (distance < tickerHalfWidth) return 0;
  if (distance < fadeRadius) return (distance - tickerHalfWidth) / fadeBuffer;
  return 1;
}

export function BarXAxis(props: BarXAxisProps) {
  return <BarXAxisInner {...props} />;
}

const BarXAxisInner = memo(function BarXAxisInner({
  tickerHalfWidth = 50,
  showAllLabels = false,
  maxLabels = 12,
}: BarXAxisProps) {
  const { tooltipData, barScale, bandWidth, barXAccessor, data, dateLabels, innerHeight } = useChart();

  // Generate labels for each bar
  const labelsToShow = useMemo(() => {
    if (!(barScale && bandWidth && barXAccessor)) {
      return [];
    }

    const allLabels = data.map((d, index) => {
      const categoryValue = barXAccessor(d);
      const label = dateLabels[index] ?? categoryValue;
      const bandX = barScale(categoryValue) ?? 0;
      const x = bandX + bandWidth / 2;
      return { label, x };
    });

    // If showAllLabels is true or we have fewer than maxLabels, show all
    if (showAllLabels || allLabels.length <= maxLabels) {
      return allLabels;
    }

    // Otherwise, skip some labels to avoid crowding
    const step = Math.ceil(allLabels.length / maxLabels);
    return allLabels.filter((_, i) => i % step === 0);
  }, [barScale, bandWidth, barXAccessor, data, dateLabels, showAllLabels, maxLabels]);

  const crosshairX = tooltipData?.x ?? null;

  return (
    <g aria-hidden="true" className="chart-bar-x-axis" fill="var(--chart-label)" fontSize={11} textAnchor="middle">
      {labelsToShow.map((item) => {
        const opacity = tickOpacity(item.x, crosshairX, tickerHalfWidth);
        return (
          <g key={`${item.label}-${item.x}`} opacity={opacity}>
            <line
              opacity={0.35}
              stroke="var(--chart-label)"
              x1={item.x}
              x2={item.x}
              y1={innerHeight}
              y2={innerHeight + 4}
            />
            <text x={item.x} y={innerHeight + 20}>
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
});

BarXAxis.displayName = "BarXAxis";

export default BarXAxis;
