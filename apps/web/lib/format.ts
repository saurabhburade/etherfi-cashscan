export function fixedPoint(raw: string | bigint, decimals: number): number {
  const value = typeof raw === "bigint" ? raw.toString() : raw;
  if (!value) return 0;
  if (decimals === 0) return Number(value);
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals) || "0";
  const fraction = decimals ? digits.slice(-decimals) : "";
  return Number(`${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`);
}

export function compactUsd(value: number): string {
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.01) return value < 0 ? "−<$0.01" : "<$0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: absolute >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: absolute >= 1_000 ? 1 : 2,
  }).format(value);
}

export function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
