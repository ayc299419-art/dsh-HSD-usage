// 核心类型与常量（纯逻辑，浏览器 / Node 通用，零依赖）
export const TIME_RANGES = ["5h", "week", "month"];

export const RANGE_LABELS = {
  "5h": "5 小时",
  week: "本周",
  month: "本月"
};

export const UNITS = {
  tokens: "tokens",
  requests: "requests",
  cost: "cost"
};

export const RANGE_COLORS = {
  "5h": "#4A90E2",   // 主柱（粗）：5 小时用量
  week: "#50C878",   // 次柱（细）：本周用量
  month: "#FF8C42"   // 第三柱（细）：本月用量
};

// 各时间维度窗口（毫秒）。month 取当月 1 号零点；week 取最近 7 天；5h 取最近 5 小时。
export function rangeBounds(range, now = Date.now()) {
  const d = new Date(now);
  if (range === "5h") {
    return { begin: now - 5 * 3600 * 1000, end: now };
  }
  if (range === "week") {
    return { begin: now - 7 * 24 * 3600 * 1000, end: now };
  }
  if (range === "month") {
    const begin = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
    return { begin, end: now };
  }
  throw new Error("unknown time range: " + range);
}

export function isInWindow(ts, range, now = Date.now()) {
  if (!ts) return false;
  const { begin, end } = rangeBounds(range, now);
  return ts >= begin && ts <= end;
}

// 实例唯一 ID = 服务商类型 + 自定义名称（冲突避免）
export function instanceId(type, name) {
  return `${type}:${name}`;
}

export function isValidInstanceName(name) {
  return typeof name === "string" && name.trim().length > 0;
}
