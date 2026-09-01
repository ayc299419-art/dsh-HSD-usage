// 主面板：只读展示实例条形柱 + 刷新。所有配置（含显隐勾选、增删改、全局设置）
// 都在 DSH「设置 → 用量监控」区块（见 SettingsSection.js）。
import { h, clear } from "./dom.js";
import { Toolbar } from "./Toolbar.js";
import { UsageBar } from "./UsageBar.js";
import { eventBus } from "../core/eventBus.js";
import { TIME_RANGES } from "../core/types.js";

export class UsagePanel {
  constructor({ manager, controller }) {
    this.manager = manager;
    this.controller = controller;
    this.root = null;
    this.listEl = null;
    this.disposers = [];
    this.subscribe();
  }

  subscribe() {
    const rerender = () => this.render();
    const events = ["usage-updated", "instances-changed", "config-changed"];
    for (const ev of events) {
      this.disposers.push(eventBus.on(ev, rerender));
    }
  }

  destroy() {
    for (const off of this.disposers) off();
    this.disposers = [];
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }

  mount() {
    this.root = h("div", { className: "dum-root", dataset: { usageMonitor: "1" } });
    this.render();
    return this.root;
  }

  baselineFor(instance) {
    const mode = (this.controller.config && this.controller.config.ratioMode) || "global";
    const defaultQuota = this.controller.config.defaultQuotaLimit || 0;
    const quota = instance.quotaLimit || defaultQuota || 0;

    // 官方用量接口直接给百分比（火山/智谱 Coding 计划）：满格 = 100%
    const anyPercent = ["usage5h", "usageWeek", "usageMonth"].some((k) => {
      const u = this.controller.getCachedUsage(instance.id);
      const d = u && u[k];
      return d && d.available && d.unit === "%";
    });
    if (anyPercent) return 100;

    if (mode === "instance") {
      const values = TIME_RANGES.map((r) => {
        const u = this.controller.getCachedUsage(instance.id);
        const key = "usage" + (r === "5h" ? "5h" : r === "week" ? "Week" : "Month");
        const d = u && u[key];
        return d && (d.available || d.source === "estimate") && typeof d.value === "number" ? d.value : 0;
      });
      return Math.max(quota, ...values, 1);
    }

    // global：所有启用实例的月用量最大值（含配额上限）
    let max = 1;
    for (const inst of this.manager.getEnabled()) {
      const q = inst.quotaLimit || defaultQuota || 0;
      if (q > max) max = q;
      const u = this.controller.getCachedUsage(inst.id);
      const d = u && u.usageMonth;
      if (d && (d.available || d.source === "estimate") && typeof d.value === "number" && d.value > max) max = d.value;
    }
    return max;
  }

  render() {
    if (!this.root) return;
    clear(this.root);
    const refreshing = this.controller.pending.size > 0;
    this.root.appendChild(
      Toolbar({
        onRefresh: () => this.controller.manualRefresh(),
        refreshing
      })
    );
    this.listEl = h("div", { className: "dum-list" });
    const instances = this.manager.getEnabled();
    if (instances.length === 0) {
      this.listEl.appendChild(h("div", { className: "dum-loading" }, "暂无显示的实例。在 设置 → 用量监控 中添加或勾选显示。"));
    } else {
      for (const inst of instances) {
        const baseline = this.baselineFor(inst);
        this.listEl.appendChild(
          UsageBar({
            instance: inst,
            usage: this.controller.getCachedUsage(inst.id),
            baseline,
            onRefreshOne: () => this.controller.manualRefresh(inst.id)
          })
        );
      }
    }
    this.root.appendChild(this.listEl);
    this.root.appendChild(this.statusLine());
  }

  // 自检状态行：显示 apply / 设置区块注册情况（便于定位设置页空白问题）
  statusLine() {
    const w = typeof window !== "undefined" ? window : null;
    const st = (w && w.__usageMonitor) || {};
    const bits = [];
    bits.push("apply: " + (st.applyRan === true ? "✓" : "✗"));
    if (st.settingsSectionRegistered === true) bits.push("设置区块: ✓");
    else if (st.settingsSectionRegistered === false) bits.push("设置区块: ✗ " + (st.settingsSectionReason || ""));
    else bits.push("设置区块: 未注册");
    return h("div", { className: "dum-status", title: "自检信息" }, "自检 " + bits.join(" · "));
  }
}
