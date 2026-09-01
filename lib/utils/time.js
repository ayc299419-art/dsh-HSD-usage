// 时间工具
import { rangeBounds, isInWindow } from "../core/types.js";

export { rangeBounds, isInWindow };

// 精确到分钟的刷新时间，如 "14:32"
export function formatClock(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatFull(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${MM}-${DD} ${formatClock(ts)}`;
}
