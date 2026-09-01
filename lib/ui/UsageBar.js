// 单个实例：紧凑单行布局 —— [套餐徽标] 名称 [5h蓝色粗柱（值在柱内）] ⟳
// 悬停该行：下方展开 周/月 细柱 + 完整 tooltip。整体高度 = 实例数 × 一行。
// baseline 由 UsagePanel.baselineFor 计算：百分比数据=100，token 数据=全局基准。
import { h } from "./dom.js";
import { RANGE_LABELS, RANGE_COLORS } from "../core/types.js";
import { formatUsage, barWidth } from "../utils/formatters.js";
import { formatClock, formatFull } from "../utils/time.js";
import { providerLogo } from "./logos.js";

function barRow({ u, color, label, thick, baseline, extraClass }) {
  const available = !!(u && (u.available || u.source === "estimate"));
  const value = u ? u.value : null;
  const width = barWidth(value, baseline);
  const isEstimate = !!(u && u.source === "estimate");
  const displayValue = u && u.available
    ? formatUsage(u.value, u.unit)
    : isEstimate
      ? formatUsage(u.value, "tokens") + "（估）"
      : "N/A";
  const fillColor = !available ? "#888" : color;
  return h(
    "div",
    { className: "dum-bar-row" + (extraClass ? " " + extraClass : "") },
    thick ? null : h("span", { className: "dum-alt-label" }, label),
    h(
      "div",
      {
        className: "dum-bar" + (thick ? "" : " dum-thin") + (available ? "" : " dum-na"),
        style: "width:" + width + "%; background:" + fillColor
      },
      h("span", { className: "dum-bar-value" }, displayValue)
    )
  );
}

export function UsageBar({ instance, usage, baseline, onRefreshOne }) {
  const u5 = usage && usage.usage5h;
  const uW = usage && usage.usageWeek;
  const uM = usage && usage.usageMonth;
  const planTag = (u5 && u5.meta && u5.meta.planTag) || "";

  const tooltipRows = [
    { key: "usage5h", range: "5h" },
    { key: "usageWeek", range: "week" },
    { key: "usageMonth", range: "month" }
  ].map(({ key, range }) => {
    const u = usage && usage[key];
    const valueText = u && u.available ? formatUsage(u.value, u.unit) : u && u.source === "estimate" ? formatUsage(u.value, "tokens") + "（估算）" : "N/A";
    const sub = u && !u.available && u.reason ? u.reason : "";
    return h(
      "div",
      { className: "dum-tooltip-row" },
      h("span", null, RANGE_LABELS[range]),
      h("span", null, valueText + (sub ? " · " + sub : ""))
    );
  });

  const lastUpdated = usage && usage.lastUpdated;
  const tooltip = h(
    "div",
    { className: "dum-tooltip" },
    h("div", { className: "dum-tooltip-title" }, instance.name + "（" + instance.type + (planTag ? " · " + (planTag === "A" ? "Agent Plan" : "Coding Plan") : "") + "）"),
    ...tooltipRows,
    h("div", { className: "dum-tooltip-note" }, "更新于 " + formatClock(lastUpdated) + (lastUpdated ? "（" + formatFull(lastUpdated) + "）" : ""))
  );

  const mainRow = h(
    "div",
    { className: "dum-main" },
    h("span", { className: "dum-logo", html: providerLogo(instance.type) }),
    h("span", { className: "dum-name", title: instance.name }, instance.name),
    barRow({ u: u5, color: RANGE_COLORS["5h"], label: "", thick: true, baseline, extraClass: "dum-bar-main" }),
    h("button", { className: "dum-refresh-one", title: "刷新此实例", onClick: onRefreshOne }, "⟳")
  );

  const altRows = h(
    "div",
    { className: "dum-alt-rows" },
    barRow({ u: uW, color: RANGE_COLORS.week, label: "周", thick: false, baseline }),
    barRow({ u: uM, color: RANGE_COLORS.month, label: "月", thick: false, baseline })
  );

  // 报错不显示在表面：原因只放进悬停 tooltip（tooltip 已按行带上 reason）
  return h("div", { className: "dum-item" }, mainRow, altRows, tooltip);
}
