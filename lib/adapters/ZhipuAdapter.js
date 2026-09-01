// 智谱 GLM (bigmodel) 适配器 —— 端点预置，API Key 即查，无需任何 URL 配置。
// 实现对齐 dsh-quota-panel 的内置目录（智谱官方用量监控接口）：
//   端点: GET https://open.bigmodel.cn/api/monitor/usage/quota/limit（Authorization: Bearer <key>）
//   Coding Plan 响应: { code: 200, data: { limits: [
//     { type: "TOKENS_LIMIT", unit: 3, currentValue, usage, percentage, nextResetTime },  // unit=3 → 5h 窗口
//     { type: "TOKENS_LIMIT", unit: 6, ... },                                             // unit=6 → 周窗口
//     { type: "TIME_LIMIT",   ... } ] } }                                                 // TIME_LIMIT → 月车道
//   非Coding计划兜底: data.limits[{ remaining, number, percentage }]（剩余/总数）
import { BaseAdapter } from "./BaseAdapter.js";

const ENDPOINT = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";

export class ZhipuAdapter extends BaseAdapter {
  type = "zhipu";

  endpointOf(credentials) {
    return (credentials && credentials.endpoint) || ENDPOINT;
  }

  async fetchLimits(credentials) {
    const apiKey = credentials && credentials.apiKey;
    if (!apiKey) throw new Error("缺少智谱 API Key");
    const { status, text } = await this.upstreamFetch(this.endpointOf(credentials), {
      method: "GET",
      headers: { Authorization: "Bearer " + apiKey, accept: "application/json" }
    });
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    if (!json) throw new Error("HTTP " + status + ": " + text.slice(0, 160));
    if (json.code !== 200 && json.code !== undefined && json.code !== 0) {
      throw new Error("智谱接口 code " + json.code + ": " + (json.msg || "unknown"));
    }
    return json;
  }

  // Coding Plan：unit=3 → 5h，unit=6 → 周，TIME_LIMIT → 月；percentage 缺失时用 currentValue/usage 兜底
  parseCodingLimits(limits) {
    if (!Array.isArray(limits) || limits.length === 0) return null;
    const pctOf = (l) => {
      const p = Number(l && l.percentage);
      if (Number.isFinite(p)) return Math.min(100, Math.max(0, Math.round(p)));
      const used = Number(l && l.currentValue);
      const total = Number(l && l.usage);
      if (Number.isFinite(used) && Number.isFinite(total) && total > 0) return Math.round(used / total * 100);
      return null;
    };
    const resetsOf = (l) => {
      const n = Number(l && l.nextResetTime);
      return Number.isFinite(n) && n > 0 ? new Date(n).getTime() : null;
    };
    // 分窗口的额度行：实测返回是 CREDIT_LIMIT（unit=3 → 5h，unit=6 → 周）；TOKENS_LIMIT 为兼容旧格式。
    // 月车道 = TIME_LIMIT（部分账号/计划不返回，则无月窗口）。
    const windowRows = limits.filter((l) => l && (l.type === "CREDIT_LIMIT" || l.type === "TOKENS_LIMIT"));
    const time = limits.find((l) => l && l.type === "TIME_LIMIT");
    let rolling = windowRows.find((l) => Number(l.unit) === 3);
    let weekly = windowRows.find((l) => Number(l.unit) === 6);
    if (!rolling && !weekly && windowRows.length > 0) {
      // 未知 unit 编码：5h 窗口总是先重置，按 nextResetTime 排序定位
      const sorted = [...windowRows].sort((a, b) => Number(a.nextResetTime ?? Infinity) - Number(b.nextResetTime ?? Infinity));
      rolling = sorted[0];
      weekly = sorted.length > 1 ? sorted[sorted.length - 1] : undefined;
    }
    const windows = {};
    if (rolling && pctOf(rolling) != null) windows["5h"] = { percent: pctOf(rolling), resetsAt: resetsOf(rolling), used: Number(rolling.currentValue), quota: Number(rolling.usage) };
    if (weekly && pctOf(weekly) != null) windows.week = { percent: pctOf(weekly), resetsAt: resetsOf(weekly), used: Number(weekly.currentValue), quota: Number(weekly.usage) };
    if (time && pctOf(time) != null) windows.month = { percent: pctOf(time), resetsAt: resetsOf(time), used: Number(time.currentValue), quota: Number(time.usage) };
    return windows["5h"] || windows.week || windows.month ? windows : null;
  }

  // 非 Coding 计划兜底：limits[{ remaining, number, percentage }]（剩余/总数）
  parsePlainLimits(limits) {
    if (!Array.isArray(limits) || limits.length === 0) return null;
    for (const l of limits) {
      const remaining = Number(l && l.remaining);
      const total = Number(l && l.number);
      if (Number.isFinite(remaining) && Number.isFinite(total) && total > 0) {
        return { month: { percent: Math.round((total - remaining) / total * 100), used: total - remaining, quota: total } };
      }
      const p = Number(l && l.percentage);
      if (Number.isFinite(p)) return { month: { percent: Math.round(p) } };
    }
    return null;
  }

  toUsageData(w, note) {
    return this.ok(w.percent, "%", {
      note: "智谱官方用量接口（百分比）" + (w.resetsAt ? "，重置于 " + new Date(w.resetsAt).toLocaleString() : ""),
      used: w.used, quota: w.quota, resetsAt: w.resetsAt || undefined, ...note
    });
  }

  async fetchAllWindows(credentials) {
    const now = Date.now();
    if (this._cache && this._cache.credentials === credentials && now - this._cache.at < 10000) {
      return this._cache.data;
    }
    const data = (async () => {
      const json = await this.fetchLimits(credentials);
      const limits = json && json.data && json.data.limits;
      // 调试用：把真实返回的 limits 结构摘要带进原因，便于定位（用户可复制红字给我）
      const rawSample = (() => {
        try {
          const arr = Array.isArray(limits) ? limits : [];
          const slim = arr.slice(0, 6).map((l) => {
            const o = { type: l && l.type, unit: l && l.unit, percentage: l && l.percentage, nextResetTime: l && l.nextResetTime };
            if (l && l.currentValue != null) o.currentValue = l.currentValue;
            if (l && l.usage != null) o.usage = l.usage;
            if (l && l.remaining != null) o.remaining = l.remaining;
            if (l && l.number != null) o.number = l.number;
            return o;
          });
          return JSON.stringify(slim);
        } catch (e) { return ""; }
      })();
      const coding = this.parseCodingLimits(limits);
      if (coding) {
        const note = { endpointKind: "coding-plan" };
        return {
          "5h": coding["5h"] ? this.toUsageData(coding["5h"], note) : this.unavailable("智谱接口未返回 5h 窗口"),
          week: coding.week ? this.toUsageData(coding.week, note) : this.unavailable("智谱接口未返回周窗口"),
          month: coding.month ? this.toUsageData(coding.month, note) : this.unavailable("智谱接口未返回月窗口（该计划仅有 5h/周窗口）")
        };
      }
      const plain = this.parsePlainLimits(limits);
      if (plain && plain.month) {
        return {
          "5h": this.unavailable("该智谱计划不提供 5h 窗口（仅配额余量）"),
          week: this.unavailable("该智谱计划不提供周窗口（仅配额余量）"),
          month: this.toUsageData(plain.month, { endpointKind: "quota-limit" })
        };
      }
      throw new Error("智谱用量接口返回结构未识别 · 接口返回: " + rawSample);
    })();
    this._cache = { credentials, at: now, data };
    data.catch(() => { if (this._cache && this._cache.data === data) this._cache = null; });
    return data;
  }

  async fetchUsage(credentials, timeRange) {
    try {
      const all = await this.fetchAllWindows(credentials);
      return all[timeRange] || this.unavailable("智谱未返回 " + timeRange + " 窗口");
    } catch (err) {
      return this.unavailable("智谱用量查询失败: " + (err && err.message ? err.message : err));
    }
  }

  async testConnection(credentials) {
    try {
      await this.fetchLimits(credentials);
      return true;
    } catch {
      return false;
    }
  }
}
