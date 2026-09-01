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

const relativeTime = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function timeAgo(timestamp: string): string {
  const elapsed = new Date(timestamp).getTime() - Date.now();
  const absoluteElapsed = Math.abs(elapsed);
  const units = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1_000],
  ] as const;
  const fallback = units[units.length - 1];
  const [unit, duration] = units.find(([, unitDuration]) => absoluteElapsed >= unitDuration) ?? fallback;

  return relativeTime.format(Math.round(elapsed / duration), unit);
}
