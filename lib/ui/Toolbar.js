// 工具栏：只读展示，仅保留刷新。管理操作移入 设置 → 用量监控。
import { h } from "./dom.js";

export function Toolbar({ onRefresh, refreshing }) {
  return h(
    "div",
    { className: "dum-toolbar" },
    h("button", { className: "dum-btn", onClick: onRefresh }, refreshing ? "刷新中…" : "刷新")
  );
}
