// 数值格式化
// 1000 -> "1.0K"，1_200_000 -> "1.2M"，单位追加为 "1.2M tokens"
export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return "N/A";
  const abs = Math.abs(n);
  if (abs >= 1e9) return trim((n / 1e9)) + "B";
  if (abs >= 1e6) return trim(n / 1e6) + "M";
  if (abs >= 1e3) return trim(n / 1e3) + "K";
  return String(Math.round(n));
}

function trim(x) {
  const s = String(Number(x.toFixed(1)));
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatUsage(value, unit = "tokens") {
  if (value == null || Number.isNaN(value)) return "N/A";
  if (unit === "%") return `${Math.round(value)}%`;
  const label = unit === "tokens" ? "tokens" : unit === "requests" ? "次请求" : unit === "cost" ? "元" : unit;
  return `${formatNumber(value)} ${label}`;
}

// 百分比宽度（0-100），支持 null
export function barWidth(value, max) {
  if (value == null || !max || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
