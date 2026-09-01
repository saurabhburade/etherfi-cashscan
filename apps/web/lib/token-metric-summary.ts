import { formatUnits } from "viem";
import type { TokenAnalyticsRow } from "./envio";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function tokenMetricSummary(
  rows: TokenAnalyticsRow[],
  amountKey: "reserveBalance" | "topUpAmount",
  usdKey: "reserveUsd" | "topUpUsd",
) {
  const nonzeroRows = rows.filter((row) => rawAmountIsNonzero(row[amountKey]));

  if (nonzeroRows.length === 0) return { tokenAmount: tokenAmount(rows, amountKey), usd: 0 };

  const fullyPriced = nonzeroRows.every((row) => row[usdKey] !== null);
  return {
    tokenAmount: tokenAmount(rows, amountKey),
    usd: fullyPriced ? nonzeroRows.reduce((total, row) => total + (row[usdKey] ?? 0), 0) : null,
  };
}

function tokenAmount(rows: TokenAnalyticsRow[], amountKey: "reserveBalance" | "topUpAmount") {
  const normalizedAmounts = rows.map((row) => {
    if (row.decimals === null) return null;
    try {
      return Number(formatUnits(BigInt(row[amountKey]), row.decimals));
    } catch {
      return null;
    }
  });
  const symbol = rows.find((row) => row.symbol)?.symbol;

  if (normalizedAmounts.every((value) => value !== null)) {
    const total = normalizedAmounts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return `${compact.format(total)} ${symbol || "tokens"}`;
  }

  return "Unpriced";
}

function rawAmountIsNonzero(value: string) {
  try {
    return BigInt(value) !== 0n;
  } catch {
    return value !== "0";
  }
}
