// 自动生成：scripts/build-client.mjs 打包 lib/**/*.js 生成。请勿手工编辑。
// DSH client bundle（id: dsh-HSD-usage）：DeepSeekHarness 用量监控插件。
(() => {
  if (typeof window === "undefined" || typeof window.__ModuleLoader__ === "undefined") {
    if (typeof globalThis !== "undefined") {
      globalThis.window = globalThis.window || {};
      if (!globalThis.window.__ModuleLoader__) {
        const pending = [];
        globalThis.window.__ModuleLoader__ = { mode: "queue", load(r) { pending.push(r); }, create() { throw new Error("client-modules 不可用（非 GUI 环境）"); } };
      }
    }
  }
  window.__ModuleLoader__.load({
    id: "dsh-HSD-usage",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      const registry = {};
      function register(path, dir, fn) { registry[path] = { fn, dir }; }
      function resolveKey(dir, spec) {
        if (!spec.startsWith(".")) return spec;
        const parts = [];
        for (const seg of (dir + "/" + spec).split("/")) {
          if (seg === "" || seg === ".") continue;
          if (seg === "..") parts.pop();
          else parts.push(seg);
        }
        return parts.join("/");
      }
      function requireFrom(dir) {
        return function (spec) {
          const key = resolveKey(dir, spec);
          const rec = registry[key];
          if (!rec) {
            // 外部依赖（react 等平台 seed 词）交给模块系统的 require 解析
            return __outerRequire(spec);
          }
          if (!rec.loaded) {
            rec.loaded = true;
            rec.module = { exports: {} };
            rec.fn(requireFrom(rec.dir), rec.module, rec.module.exports);
          }
          return rec.module.exports;
        };
      }
  register("adapters/BaseAdapter.js", "adapters", function(require, module, exports) {
    // 适配器基类：统一 UsageProviderAdapter 接口 + 公共辅助
    // UsageData = { value, unit, timestamp, available, source?, reason?, meta? }
    class BaseAdapter {
      constructor() {
        if (this.constructor === BaseAdapter) throw new Error("BaseAdapter 是抽象类");
        this.type = "base";
      }
    
      async fetchUsage(credentials, timeRange) {
        throw new Error("fetchUsage 未实现");
      }
    
      async testConnection(credentials) {
        try {
          await this.fetchUsage(credentials, "5h");
          return true;
        } catch {
          return false;
        }
      }
    
      ok(value, unit = "tokens", meta = {}) {
        return { value, unit, timestamp: Date.now(), available: true, source: "api", meta };
      }
    
      unavailable(reason, meta = {}) {
        return { value: null, unit: "tokens", timestamp: Date.now(), available: false, reason, meta };
      }
    
      // 通用 JSON fetch：对非 2xx 抛出可读错误
      async fetchJson(url, options = {}) {
        const res = await fetch(url, options);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
      }
    
      // 上游请求：浏览器端走宿主 loopback 代理（规避 CORS，凭据不出本机）；Node/CLI 直连。
      // 返回 { status, text }；代理/上游的失败都以可读 Error 抛出（不静默）。
      async upstreamFetch(url, options = {}) {
        const inBrowser = typeof window !== "undefined";
        const method = (options.method || "GET").toUpperCase();
        const headers = options.headers || {};
        const body = options.body;
        if (!inBrowser) {
          const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
          const text = await res.text().catch(() => "");
          if (!res.ok && !text) throw new Error(`HTTP ${res.status}`);
          return { status: res.status, text };
        }
        const res = await fetch("/api/dsh-hsd-usage/proxy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, method, headers, body: body ? String(body) : undefined })
        });
        if (!res.ok) throw new Error(`代理路由 HTTP ${res.status}`);
        const envelope = await res.json();
        if (!envelope || envelope.ok !== true) throw new Error("代理请求失败");
        let parsed = null;
        try { parsed = JSON.parse(envelope.body); } catch { /* 非 JSON */ }
        const proxyErr = parsed && parsed.__proxyError;
        if (proxyErr) throw new Error(proxyErr);
        if (envelope.status === 0) throw new Error("上游无响应");
        if (!parsed) throw new Error(`上游 HTTP ${envelope.status}: 非 JSON 响应`.slice(0, 200));
        const upstreamErr = parsed && (parsed.ResponseMetadata && parsed.ResponseMetadata.Error);
        if (upstreamErr && envelope.status >= 400) throw new Error(`HTTP ${envelope.status}: ${upstreamErr.Code || ""} ${upstreamErr.Message || ""}`.trim());
        return { status: envelope.status, text: envelope.body };
      }
    
      // 容错解析：优先按候选路径取值，取不到返回 undefined
      pick(obj, paths) {
        if (!obj || typeof obj !== "object") return undefined;
        for (const p of paths) {
          let cur = obj;
          let ok = true;
          for (const seg of String(p).split(".")) {
            if (cur == null || typeof cur !== "object" || !(seg in cur)) { ok = false; break; }
            cur = cur[seg];
          }
          if (ok) return cur;
        }
        return undefined;
      }
    }
    
    exports.BaseAdapter = BaseAdapter;
  });

  register("adapters/DeepSeekAdapter.js", "adapters", function(require, module, exports) {
    // DeepSeek 适配器
    // 官方余额接口（真实可用）：GET https://api.deepseek.com/user/balance
    // 注意：DeepSeek 目前没有按时间分桶（5h/周/月）的公开用量接口，
    // 因此本适配器返回余额信息（meta.balance）并把数值标记为不可用，
    // 由控制器的本地记录估算回退填充 5h/周/月 用量。
    const { BaseAdapter } = require("./BaseAdapter.js");
    
    class DeepSeekAdapter extends BaseAdapter {
      type = "deepseek";
    
      get balanceUrl() {
        return "https://api.deepseek.com/user/balance";
      }
    
      async fetchBalance(credentials) {
        const apiKey = credentials && credentials.apiKey;
        if (!apiKey) throw new Error("缺少 DeepSeek API Key");
        const data = await this.fetchJson(this.balanceUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          }
        });
        const info = this.pick(data, ["balance_infos", "data.balance_infos"]);
        const first = Array.isArray(info) && info.length ? info[0] : null;
        return {
          isAvailable: !!this.pick(data, ["is_available"]),
          totalBalance: first ? this.pick(first, ["total_balance"]) : undefined,
          grantedBalance: first ? this.pick(first, ["granted_balance"]) : undefined,
          toppedUpBalance: first ? this.pick(first, ["topped_up_balance"]) : undefined,
          currency: first ? this.pick(first, ["currency"]) : "CNY"
        };
      }
    
      async fetchUsage(credentials, timeRange) {
        let balance = null;
        try {
          balance = await this.fetchBalance(credentials);
        } catch (err) {
          return this.unavailable("余额查询失败: " + (err && err.message ? err.message : err));
        }
        return this.unavailable("DeepSeek 未提供按时间分桶的用量接口（仅余额可用）", {
          balance,
          model: "balance-only"
        });
      }
    
      async testConnection(credentials) {
        try {
          await this.fetchBalance(credentials);
          return true;
        } catch {
          return false;
        }
      }
    }
    
    exports.DeepSeekAdapter = DeepSeekAdapter;
  });

  register("adapters/VolcanoAdapter.js", "adapters", function(require, module, exports) {
    // 火山方舟 (Volcano Ark) 适配器 —— 端点/签名/解析全部预置，无需手工配置 URL。
    // 实现对齐社区成熟实现（dsh-quota-panel / dsh-volcengine-usage）：
    //   端点: POST https://open.volcengineapi.com/?Action=<A>&Region=<R>&Version=2024-01-01（空 body）
    //   签名: 火山变体 HMAC-SHA256 —— 三个与标准 SigV4 不同的坑：
    //     1) SignedHeaders 固定顺序 host;x-date;x-content-sha256;content-type（非字母序）
    //     2) 算法串是裸 "HMAC-SHA256"（无 AWS4 前缀），credential scope 以 /request 结尾
    //     3) 第一层派生密钥 = HMAC(原始 SK, 日期)（SK 不加前缀）
    //   查询: 两步 fallback —— GetAFPUsage（Agent Plan，Quota/Used/ResetTime）
    //         → GetCodingPlanUsage（Coding Plan，QuotaUsage[] Level/Percent/ResetTimestamp）
    //   返回: 三个时间维度的百分比（API 只给百分比），柱状图直接按百分比渲染。
    const { BaseAdapter } = require("./BaseAdapter.js");
    const { sha256Hex, hmacSha256Hex, hmacSha256Bytes } = require("../utils/crypto.js");
    
    const HOST = "open.volcengineapi.com";
    const SERVICE = "ark";
    const VERSION = "2024-01-01";
    const CONTENT_TYPE = "application/json; charset=utf-8";
    const SIGNED_HEADERS = "host;x-date;x-content-sha256;content-type";
    
    function volcUriEncode(input) {
      let out = "";
      for (const b of new TextEncoder().encode(input)) {
        if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x5f || b === 0x2e || b === 0x7e) {
          out += String.fromCharCode(b);
        } else {
          out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
        }
      }
      return out;
    }
    
    function canonicalQuery(action, region) {
      const pairs = [["Action", action], ["Region", region], ["Version", VERSION]].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return pairs.map(([k, v]) => volcUriEncode(k) + "=" + volcUriEncode(v)).join("&");
    }
    
    class VolcanoAdapter extends BaseAdapter {
      type = "volcano";
    
      regionOf(credentials) {
        // 显式 region 优先；否则从 usageUrl 里的 ark.<region>.volces.com 推断；默认北京
        const region = credentials && credentials.region;
        if (region) return region;
        const m = /ark\.([a-z0-9-]+)\.volces\.com/.exec((credentials && credentials.usageUrl) || "");
        return m ? m[1] : "cn-beijing";
      }
    
      async call(action, credentials) {
        const { accessKeyId, secretAccessKey } = credentials || {};
        if (!accessKeyId || !secretAccessKey) throw new Error("缺少火山 AK/SK（accessKeyId / secretAccessKey）");
        const region = this.regionOf(credentials);
        const query = canonicalQuery(action, region);
        const url = "https://" + HOST + "/?" + query;
        const now = new Date();
        const xDate = now.toISOString().replace(/[:-]/g, "").slice(0, 15) + "Z";
        const shortDate = xDate.slice(0, 8);
        const body = "";
        const payloadHash = await sha256Hex(body);
        // 固定（非字母序）的 canonical headers 顺序 —— 火山签名的坑之一
        const canonicalHeaders =
          "host:" + HOST + "\n" +
          "x-date:" + xDate + "\n" +
          "x-content-sha256:" + payloadHash + "\n" +
          "content-type:" + CONTENT_TYPE + "\n";
        const canonicalRequest = ["POST", "/", query, canonicalHeaders, SIGNED_HEADERS, payloadHash].join("\n");
        const credentialScope = shortDate + "/" + region + "/" + SERVICE + "/request";
        const stringToSign = ["HMAC-SHA256", xDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");
        // 原始字节链式派生（第二/三/四个坑：裸算法名、/request scope、raw SK 首层）
        const kDate = await hmacSha256Bytes(new TextEncoder().encode(secretAccessKey), shortDate);
        const kRegion = await hmacSha256Bytes(kDate, region);
        const kService = await hmacSha256Bytes(kRegion, SERVICE);
        const kSigning = await hmacSha256Bytes(kService, "request");
        const signature = await hmacSha256Hex(kSigning, stringToSign);
        const authorization = "HMAC-SHA256 Credential=" + accessKeyId + "/" + credentialScope +
          ", SignedHeaders=" + SIGNED_HEADERS + ", Signature=" + signature;
        const { status, text } = await this.upstreamFetch(url, {
          method: "POST",
          headers: {
            Host: HOST,
            "X-Date": xDate,
            "X-Content-Sha256": payloadHash,
            "Content-Type": CONTENT_TYPE,
            Authorization: authorization
          },
          body
        });
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON */ }
        const err = json && (json.ResponseMetadata && json.ResponseMetadata.Error);
        if (err) throw new Error("火山 " + (err.Code || "Unknown") + ": " + (err.Message || "unknown"));
        if (status >= 400) throw new Error("HTTP " + status + (text ? ": " + text.slice(0, 160) : ""));
        return json;
      }
    
      // GetAFPUsage（Agent Plan）：Result.AFPFiveHour / AFPWeekly / AFPMonthly {Quota, Used, ResetTime}
      parseAFP(result) {
        const pickWin = (key) => {
          const w = result && result[key];
          if (!w) return null;
          const quota = Number(w.Quota);
          if (!Number.isFinite(quota) || quota <= 0) return null; // Quota<=0 = 未订阅该窗口
          const used = Number(w.Used) || 0;
          const percent = Math.min(100, Math.max(0, Math.round(used / quota * 100)));
          return { percent, used, quota, resetsAt: Number(w.ResetTime) > 0 ? Number(w.ResetTime) * 1000 : null };
        };
        const windows = { "5h": pickWin("AFPFiveHour"), week: pickWin("AFPWeekly"), month: pickWin("AFPMonthly") };
        return windows["5h"] || windows.week || windows.month ? windows : null;
      }
    
      // GetCodingPlanUsage（Coding Plan）：Result.QuotaUsage[] {Level, Percent, ResetTimestamp(秒, -1 无重置)}
      parseCodingPlan(result) {
        const arr = (result && (result.QuotaUsage || result.Usages || result.Details)) || null;
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const slotFor = (label) => {
          const l = String(label).toLowerCase();
          if (l === "session" || l === "5h" || l === "fivehour" || l === "five_hour" || l === "rolling_5h") return "5h";
          if (l === "weekly" || l === "week" || l === "7d") return "week";
          if (l === "monthly" || l === "month") return "month";
          return null;
        };
        const windows = {};
        for (const item of arr) {
          const slot = slotFor(item && (item.Level || item.Type || item.Period || item.Label || item.Window));
          if (!slot) continue;
          const percent = Number(item && (item.Percent || item.UsedPercent || item.UsagePercent));
          if (!Number.isFinite(percent)) continue;
          const reset = Number(item && (item.ResetTime || item.ResetTimestamp));
          windows[slot] = {
            percent: Math.min(100, Math.max(0, Math.round(percent))),
            resetsAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : null
          };
        }
        return windows["5h"] || windows.week || windows.month ? windows : null;
      }
    
      toUsageData(w, planLabel) {
        // 套餐首字母徽标：Agent Plan → "A"，Coding Plan → "C"（面板在实例名前展示）
        const tag = /coding/i.test(planLabel || "") ? "C" : /agent/i.test(planLabel || "") ? "A" : "";
        return this.ok(w.percent, "%", {
          plan: planLabel,
          planTag: tag,
          note: "火山官方用量接口（百分比）" + (w.resetsAt ? "，重置于 " + new Date(w.resetsAt).toLocaleString() : ""),
          used: w.used, quota: w.quota, resetsAt: w.resetsAt || undefined
        });
      }
    
      // 一次拿全三个窗口（Controller 会并发调三次 fetchUsage，这里做 10s 去重缓存）
      async fetchAllWindows(credentials) {
        const now = Date.now();
        if (this._cache && this._cache.credentials === credentials && now - this._cache.at < 10000) {
          return this._cache.data;
        }
        const plan = ((credentials && credentials.plan) || "auto").toLowerCase();
        const data = (async () => {
          // plan=agent：只查 Agent Plan；plan=coding：只查 Coding Plan；auto：先 Agent 后 Coding
          if (plan === "agent") return this.fetchAgentPlan(credentials);
          if (plan === "coding") return this.fetchCodingPlan(credentials);
          try {
            return await this.fetchAgentPlan(credentials);
          } catch (e) { /* Agent Plan 查询失败/未订阅 → 尝试 Coding Plan */ }
          return this.fetchCodingPlan(credentials);
        })();
        this._cache = { credentials, at: now, data };
        data.catch(() => { if (this._cache && this._cache.data === data) this._cache = null; });
        return data;
      }
    
      async fetchAgentPlan(credentials) {
        const afp = await this.call("GetAFPUsage", credentials);
        const windows = this.parseAFP(afp && (afp.Result || afp));
        if (!windows) throw new Error("该账号下没有生效的 Agent Plan 订阅");
        const plan = (afp.Result && afp.Result.PlanType) || (afp && afp.PlanType);
        const label = "Agent Plan" + (plan ? " " + plan : "");
        return {
          "5h": windows["5h"] ? this.toUsageData(windows["5h"], label) : this.unavailable(label + " 未提供 5h 窗口"),
          week: windows.week ? this.toUsageData(windows.week, label) : this.unavailable(label + " 未提供周窗口"),
          month: windows.month ? this.toUsageData(windows.month, label) : this.unavailable(label + " 未提供月窗口")
        };
      }
    
      async fetchCodingPlan(credentials) {
        const cp = await this.call("GetCodingPlanUsage", credentials);
        const windows = this.parseCodingPlan(cp && (cp.Result || cp));
        if (!windows) throw new Error("该账号下没有生效的 Coding Plan 订阅");
        const label = "Coding Plan";
        return {
          "5h": windows["5h"] ? this.toUsageData(windows["5h"], label) : this.unavailable(label + " 未提供 5h 窗口"),
          week: windows.week ? this.toUsageData(windows.week, label) : this.unavailable(label + " 未提供周窗口"),
          month: windows.month ? this.toUsageData(windows.month, label) : this.unavailable(label + " 未提供月窗口")
        };
      }
    
      async fetchUsage(credentials, timeRange) {
        try {
          const all = await this.fetchAllWindows(credentials);
          return all[timeRange] || this.unavailable("火山未返回 " + timeRange + " 窗口");
        } catch (err) {
          return this.unavailable("火山用量查询失败: " + (err && err.message ? err.message : err));
        }
      }
    
      async testConnection(credentials) {
        try {
          await this.call("GetCodingPlanUsage", credentials);
          return true;
        } catch (err) {
          // 签名错误（鉴权类）返回 false；业务性"无订阅"也算连接成功
          const msg = String((err && err.message) || err);
          return !/Signature|Credential|InvalidAccessKey|AuthFailure/i.test(msg);
        }
      }
    }
    
    exports.VolcanoAdapter = VolcanoAdapter;
  });

  register("adapters/ZhipuAdapter.js", "adapters", function(require, module, exports) {
    // 智谱 GLM (bigmodel) 适配器 —— 端点预置，API Key 即查，无需任何 URL 配置。
    // 实现对齐 dsh-quota-panel 的内置目录（智谱官方用量监控接口）：
    //   端点: GET https://open.bigmodel.cn/api/monitor/usage/quota/limit（Authorization: Bearer <key>）
    //   Coding Plan 响应: { code: 200, data: { limits: [
    //     { type: "TOKENS_LIMIT", unit: 3, currentValue, usage, percentage, nextResetTime },  // unit=3 → 5h 窗口
    //     { type: "TOKENS_LIMIT", unit: 6, ... },                                             // unit=6 → 周窗口
    //     { type: "TIME_LIMIT",   ... } ] } }                                                 // TIME_LIMIT → 月车道
    //   非Coding计划兜底: data.limits[{ remaining, number, percentage }]（剩余/总数）
    const { BaseAdapter } = require("./BaseAdapter.js");
    
    const ENDPOINT = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
    
    class ZhipuAdapter extends BaseAdapter {
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
    
    exports.ZhipuAdapter = ZhipuAdapter;
  });

  register("adapters/index.js", "adapters", function(require, module, exports) {
    // 适配器注册表
    const { DeepSeekAdapter } = require("./DeepSeekAdapter.js");
    const { ZhipuAdapter } = require("./ZhipuAdapter.js");
    const { VolcanoAdapter } = require("./VolcanoAdapter.js");
    
    const adapters = new Map();
    
    function registerAdapter(adapter) {
      if (!adapter || !adapter.type) throw new Error("适配器缺少 type");
      adapters.set(adapter.type, adapter);
    }
    
    function getAdapter(type) {
      return adapters.get(type);
    }
    
    function getAllAdapterTypes() {
      return [...adapters.keys()];
    }
    
    function getAllAdapters() {
      return [...adapters.values()];
    }
    
    // 注册内置适配器
    registerAdapter(new DeepSeekAdapter());
    registerAdapter(new ZhipuAdapter());
    registerAdapter(new VolcanoAdapter());
    
    // 类型展示名与凭据字段说明（供配置界面动态生成表单）
    // 端点全部预置：火山（open.volcengineapi.com 两步用量查询）、智谱（官方用量监控接口），无需手工填 URL
    const ADAPTER_META = {
      deepseek: { label: "DeepSeek", fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }] },
      zhipu: { label: "智谱 GLM / Coding 计划", fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }] },
      volcano: {
        label: "火山方舟（Agent/Coding Plan）",
        fields: [
          { key: "accessKeyId", label: "Access Key ID", type: "text", required: true },
          { key: "secretAccessKey", label: "Secret Access Key", type: "password", required: true },
          { key: "plan", label: "查询的套餐（两套都订阅就各建一个实例）", type: "select", required: false,
            options: [
              { value: "agent", label: "Agent Plan" },
              { value: "coding", label: "Coding Plan" },
              { value: "auto", label: "自动（先 Agent，查不到再 Coding）" }
            ] },
          { key: "region", label: "Region（默认 cn-beijing，可不填）", type: "text", required: false }
        ]
      }
    };
    
    exports.registerAdapter = registerAdapter;
    exports.getAdapter = getAdapter;
    exports.getAllAdapterTypes = getAllAdapterTypes;
    exports.getAllAdapters = getAllAdapters;
    exports.ADAPTER_META = ADAPTER_META;
  });

  register("core/Controller.js", "core", function(require, module, exports) {
    // 核心控制器：数据聚合、调度、缓存、事件监听。
    // 职责：
    //  - 遍历启用实例，调用适配器获取 5h / 周 / 月 用量
    //  - 适配器失败时，若配置了本地估算则回退估算（标记 source=estimate），否则标记不可用
    //  - 定时自动刷新（默认 300s，可配）
    //  - 监听模型切换事件（onModelChanged），刷新映射实例
    //  - 以实例 ID 为键缓存 InstanceUsage，并广播 usage-updated 事件
    const { TIME_RANGES } = require("./types.js");
    const { eventBus } = require("./eventBus.js");
    const { getAdapter } = require("../adapters/index.js");
    
    const DEFAULT_INTERVAL = 5 * 60 * 1000; // 默认 5 分钟
    
    class Controller {
      constructor(options = {}) {
        this.manager = options.manager;
        this.adapters = options.adapters || null; // 兼容注入注册表
        this.localSource = options.localSource || null;
        this.useLocalFallback = options.useLocalFallback !== false;
        this.cache = new Map();
        this.refreshIntervalMs = options.refreshIntervalMs || DEFAULT_INTERVAL;
        this.timer = null;
        this.pending = new Map(); // instanceId -> Promise
        this.modelMapping = options.modelMapping || null; // { modelPrefix -> instanceId[] } 或函数
        this.started = false;
        // 配置状态
        this.config = {
          refreshIntervalMs: this.refreshIntervalMs,
          ratioMode: options.ratioMode || "global", // 'global' | 'instance'
          unitPreference: options.unitPreference || "tokens",
          defaultQuotaLimit: options.defaultQuotaLimit || null
        };
        this.setupEvents();
      }
    
      setupEvents() {
        this._disposers = [];
        this._disposers.push(eventBus.on("instances-changed", () => {
          // 实例增删后，清理已不存在的缓存
          const ids = new Set(this.manager.getAll().map((i) => i.id));
          for (const key of this.cache.keys()) {
            if (!ids.has(key)) this.cache.delete(key);
          }
        }));
      }
    
      // ---- 配置 ----
      updateConfig(patch) {
        this.config = { ...this.config, ...patch };
        if (patch.refreshIntervalMs) {
          this.setRefreshInterval(patch.refreshIntervalMs);
        }
        eventBus.emit("config-changed", this.config);
      }
    
      // ---- 调度 ----
      start() {
        if (this.started) return;
        this.started = true;
        const tick = () => this.refreshAll();
        this.timer = setInterval(tick, this.config.refreshIntervalMs);
        // 浏览器环境避免定时器被节流（后台标签页不可靠，属可接受）
      }
    
      stop() {
        this.started = false;
        if (this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
      }
    
      setRefreshInterval(ms) {
        this.config.refreshIntervalMs = Math.max(10000, ms || DEFAULT_INTERVAL);
        if (this.started) {
          this.stop();
          this.start();
        }
      }
    
      // ---- 数据访问 ----
      getCachedUsage(instanceId) {
        return this.cache.get(instanceId);
      }
    
      getAllCachedUsages() {
        return this.cache;
      }
    
      // ---- 刷新 ----
      async refreshAll() {
        const instances = this.manager.getEnabled();
        await Promise.all(instances.map((inst) => this.refreshInstance(inst.id)));
      }
    
      async refreshInstance(instanceId) {
        if (this.pending.has(instanceId)) return this.pending.get(instanceId);
        const instance = this.manager.getById(instanceId);
        if (!instance || !instance.enabled) return;
    
        const task = (async () => {
          const cached = this.cache.get(instanceId);
          this.cache.set(instanceId, {
            instanceId,
            ...(cached || {}),
            lastUpdated: Date.now(),
            refreshing: true
          });
          eventBus.emit("usage-updated", instanceId, this.cache.get(instanceId));
    
          const adapter = (this.adapters || getAdapter)(instance.type);
          const usage = { instanceId, lastUpdated: Date.now(), refreshing: false };
    
          try {
            if (adapter) {
              const results = await Promise.all(
                TIME_RANGES.map((range) => Promise.resolve(adapter.fetchUsage(instance.credentials, range)))
              );
              TIME_RANGES.forEach((range, idx) => {
                usage[`usage${range === "5h" ? "5h" : range === "week" ? "Week" : "Month"}`] = results[idx];
              });
            } else {
              // 适配器未注册：全部标记不可用
              TIME_RANGES.forEach((range) => {
                usage[`usage${range === "5h" ? "5h" : range === "week" ? "Week" : "Month"}`] = {
                  value: null, unit: this.config.unitPreference, timestamp: Date.now(),
                  available: false, reason: `适配器未注册: ${instance.type}`
                };
              });
            }
          } catch (err) {
            TIME_RANGES.forEach((range) => {
              usage[`usage${range === "5h" ? "5h" : range === "week" ? "Week" : "Month"}`] = {
                value: null, unit: this.config.unitPreference, timestamp: Date.now(),
                available: false, reason: err && err.message ? err.message : String(err)
              };
            });
          }
    
          // 回退：把不可用的维度用本地估算填充（source=estimate）
          if (this.localSource && this.useLocalFallback) {
            for (const range of TIME_RANGES) {
              const key = `usage${range === "5h" ? "5h" : range === "week" ? "Week" : "Month"}`;
              const cur = usage[key];
              if (!cur || !cur.available) {
                try {
                  const est = await this.localSource.estimate(range);
                  if (est != null) {
                    usage[key] = {
                      value: est,
                      unit: "tokens",
                      timestamp: Date.now(),
                      available: false,
                      source: "estimate",
                      reason: "服务商 API 不可用，已按本地会话记录估算"
                    };
                  }
                } catch (e) {
                  // 忽略本地估算失败
                }
              }
            }
          }
    
          this.cache.set(instanceId, usage);
          eventBus.emit("usage-updated", instanceId, usage);
          return usage;
        })();
    
        this.pending.set(instanceId, task);
        try {
          return await task;
        } finally {
          this.pending.delete(instanceId);
        }
      }
    
      // ---- 模型切换 ----
      // modelName 示例："deepseek-v4-flash-ga-260731" / "GLM-5.3" / "kimi-k3"
      onModelChanged(modelName) {
        const instances = this.manager.getEnabled();
        if (!modelName || instances.length === 0) return;
        const matched = this.resolveModelMapping(modelName);
        if (matched && matched.length > 0) {
          matched.forEach((id) => this.refreshInstance(id));
        } else {
          // 无法映射则刷新所有启用实例（降级）
          instances.forEach((inst) => this.refreshInstance(inst.id));
        }
      }
    
      resolveModelMapping(modelName) {
        const m = String(modelName || "").toLowerCase();
        if (typeof this.modelMapping === "function") {
          return this.modelMapping(m);
        }
        if (this.modelMapping && typeof this.modelMapping === "object") {
          // { modelPrefix: [instanceId...] }
          for (const [prefix, ids] of Object.entries(this.modelMapping)) {
            if (m.includes(String(prefix).toLowerCase())) return ids;
          }
          return null;
        }
        // 自动推断：模型名包含实例类型关键字（deepseek/zhipu/glm/volcano/ark/kimi）时匹配
        const instances = this.manager.getEnabled();
        const keywords = {
          deepseek: ["deepseek"],
          zhipu: ["zhipu", "glm"],
          volcano: ["volcano", "ark", "huoshan"],
          kimi: ["kimi", "moonshot"]
        };
        for (const inst of instances) {
          const keys = keywords[inst.type] || [inst.type];
          if (keys.some((k) => m.includes(k))) return [inst.id];
        }
        return null;
      }
    
      // 供 UI / 外部调用的手动刷新入口
      async manualRefresh(instanceId) {
        if (instanceId) return this.refreshInstance(instanceId);
        return this.refreshAll();
      }
    }
    
    exports.Controller = Controller;
  });

  register("core/InstanceManager.js", "core", function(require, module, exports) {
    // 实例管理器：多服务商实例的增删改查、冲突检测、启用/隐藏、持久化。
    // 依赖注入 storage 与 eventBus，便于浏览器（localStorage）与 Node（文件）复用。
    const { instanceId, isValidInstanceName } = require("./types.js");
    const { eventBus } = require("./eventBus.js");
    const { createStorage } = require("./storage.js");
    
    const KEY = "instances";
    
    function normalizeCredentialInput(credentials) {
      const out = {};
      if (!credentials) return out;
      for (const [k, v] of Object.entries(credentials)) {
        if (typeof v === "string" && v.length > 0) out[k] = v;
      }
      return out;
    }
    
    class InstanceManager {
      constructor(options = {}) {
        this.storage = options.storage || createStorage();
        this.instances = [];
        this.load();
      }
    
      load() {
        const saved = this.storage.getJSON(KEY, null);
        this.instances = Array.isArray(saved) ? saved : [];
        // 兜底：老数据补齐字段（order 缺失时按现有顺序补）
        this.instances = this.instances.map((it, idx) => ({
          enabled: true,
          quotaLimit: undefined,
          order: idx,
          ...it,
          order: Number.isInteger(it.order) ? it.order : idx
        }));
      }
    
      persist() {
        this.storage.setJSON(KEY, this.instances);
        eventBus.emit("instances-changed", this.instances);
      }
    
      // 统一按 order 排序（order 相同按创建时间兜底）
      sorted(list) {
        return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
      }
    
      getAll() {
        return this.sorted(this.instances);
      }
    
      getEnabled() {
        return this.sorted(this.instances.filter((i) => i.enabled));
      }
    
      getById(id) {
        return this.instances.find((i) => i.id === id);
      }
    
      add(input) {
        const name = (input.name || "").trim();
        if (!isValidInstanceName(name)) throw new Error("自定义名称不能为空");
        const type = (input.type || "").trim();
        if (!type) throw new Error("服务商类型不能为空");
        const id = instanceId(type, name);
        if (this.getById(id)) {
          throw new Error(`实例名称冲突："${name}" 已存在同一服务商下，请使用不同的自定义名称`);
        }
        const instance = {
          id,
          type,
          name,
          credentials: normalizeCredentialInput(input.credentials),
          quotaLimit: typeof input.quotaLimit === "number" && input.quotaLimit > 0 ? input.quotaLimit : undefined,
          enabled: input.enabled !== false,
          order: this.instances.reduce((m, i) => Math.max(m, (Number.isInteger(i.order) ? i.order : 0) + 1), 0),
          createdAt: Date.now()
        };
        this.instances.push(instance);
        this.persist();
        return instance;
      }
    
      update(id, updates) {
        const idx = this.instances.findIndex((i) => i.id === id);
        if (idx === -1) return false;
        const next = { ...this.instances[idx], ...updates };
        if (updates.name !== undefined) {
          const name = (updates.name || "").trim();
          if (!isValidInstanceName(name)) throw new Error("自定义名称不能为空");
          const newId = instanceId(next.type, name);
          if (newId !== id && this.getById(newId)) {
            throw new Error(`实例名称冲突："${name}" 已存在`);
          }
          next.id = newId;
          next.name = name;
        }
        if (updates.credentials !== undefined) next.credentials = normalizeCredentialInput(updates.credentials);
        if (updates.quotaLimit !== undefined) {
          next.quotaLimit = typeof updates.quotaLimit === "number" && updates.quotaLimit > 0 ? updates.quotaLimit : undefined;
        }
        this.instances[idx] = next;
        this.persist();
        return true;
      }
    
      remove(id) {
        const before = this.instances.length;
        this.instances = this.instances.filter((i) => i.id !== id);
        if (this.instances.length !== before) {
          this.persist();
          return true;
        }
        return false;
      }
    
      setEnabled(id, enabled) {
        const inst = this.getById(id);
        if (inst) {
          inst.enabled = !!enabled;
          this.persist();
        }
      }
    
      toggleEnabled(id) {
        const inst = this.getById(id);
        if (inst) {
          this.setEnabled(id, !inst.enabled);
          return inst.enabled;
        }
        return false;
      }
    
      // 拖动排序：按给定 id 顺序重排（缺失的 id 保持在末尾，原有相对顺序不变）
      reorder(orderedIds) {
        if (!Array.isArray(orderedIds) || orderedIds.length === 0) return false;
        const rank = new Map();
        orderedIds.forEach((id, idx) => rank.set(id, idx));
        const rest = this.instances
          .filter((i) => !rank.has(i.id))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        let next = orderedIds.length;
        for (const inst of rest) rank.set(inst.id, next++);
        for (const inst of this.instances) inst.order = rank.get(inst.id) ?? inst.order ?? 0;
        this.persist();
        return true;
      }
    
      // 批量工具（工具栏）
      showAll() {
        for (const it of this.instances) it.enabled = true;
        this.persist();
      }
      hideAll() {
        for (const it of this.instances) it.enabled = false;
        this.persist();
      }
      invert() {
        for (const it of this.instances) it.enabled = !it.enabled;
        this.persist();
      }
    }
    
    exports.InstanceManager = InstanceManager;
  });

  register("core/eventBus.js", "core", function(require, module, exports) {
    // 极简事件总线（浏览器 / Node 通用）
    class EventBus {
      constructor() {
        this.handlers = new Map();
      }
      on(event, handler) {
        let list = this.handlers.get(event);
        if (!list) {
          list = new Set();
          this.handlers.set(event, list);
        }
        list.add(handler);
        return () => this.off(event, handler);
      }
      off(event, handler) {
        const list = this.handlers.get(event);
        if (list) list.delete(handler);
      }
      emit(event, ...args) {
        const list = this.handlers.get(event);
        if (!list) return;
        for (const handler of [...list]) {
          try {
            handler(...args);
          } catch (err) {
            console.error("[dsh-HSD-usage] event handler error:", err);
          }
        }
      }
      once(event, handler) {
        const off = this.on(event, (...args) => {
          off();
          handler(...args);
        });
      }
    }
    
    const eventBus = new EventBus();
    
    exports.EventBus = EventBus;
    exports.eventBus = eventBus;
  });

  register("core/storage.js", "core", function(require, module, exports) {
    // 持久化：浏览器用 localStorage；Node / 无 localStorage 时退化为内存 Map。
    // 键统一加前缀 dsh-HSD-usage:
    const PREFIX = "dsh-HSD-usage:";
    
    function createStorage(options = {}) {
      const mem = new Map();
      const useLocalStorage = typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined";
      const prefix = options.prefix || PREFIX;
    
      function get(key) {
        const k = prefix + key;
        if (useLocalStorage) {
          const raw = globalThis.localStorage.getItem(k);
          return raw == null ? null : raw;
        }
        return mem.has(k) ? mem.get(k) : null;
      }
      function set(key, value) {
        const k = prefix + key;
        if (useLocalStorage) {
          globalThis.localStorage.setItem(k, value);
        } else {
          mem.set(k, value);
        }
      }
      function remove(key) {
        const k = prefix + key;
        if (useLocalStorage) {
          globalThis.localStorage.removeItem(k);
        } else {
          mem.delete(k);
        }
      }
      function getJSON(key, fallback = null) {
        const raw = get(key);
        if (raw == null || raw === "") return fallback;
        try {
          return JSON.parse(raw);
        } catch {
          return fallback;
        }
      }
      function setJSON(key, value) {
        set(key, JSON.stringify(value));
      }
      return { get, set, remove, getJSON, setJSON };
    }
    
    // 默认共享单例
    const storage = createStorage();
    
    exports.createStorage = createStorage;
    exports.storage = storage;
  });

  register("core/types.js", "core", function(require, module, exports) {
    // 核心类型与常量（纯逻辑，浏览器 / Node 通用，零依赖）
    const TIME_RANGES = ["5h", "week", "month"];
    
    const RANGE_LABELS = {
      "5h": "5 小时",
      week: "本周",
      month: "本月"
    };
    
    const UNITS = {
      tokens: "tokens",
      requests: "requests",
      cost: "cost"
    };
    
    const RANGE_COLORS = {
      "5h": "#4A90E2",   // 主柱（粗）：5 小时用量
      week: "#50C878",   // 次柱（细）：本周用量
      month: "#FF8C42"   // 第三柱（细）：本月用量
    };
    
    // 各时间维度窗口（毫秒）。month 取当月 1 号零点；week 取最近 7 天；5h 取最近 5 小时。
    function rangeBounds(range, now = Date.now()) {
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
    
    function isInWindow(ts, range, now = Date.now()) {
      if (!ts) return false;
      const { begin, end } = rangeBounds(range, now);
      return ts >= begin && ts <= end;
    }
    
    // 实例唯一 ID = 服务商类型 + 自定义名称（冲突避免）
    function instanceId(type, name) {
      return `${type}:${name}`;
    }
    
    function isValidInstanceName(name) {
      return typeof name === "string" && name.trim().length > 0;
    }
    
    exports.TIME_RANGES = TIME_RANGES;
    exports.RANGE_LABELS = RANGE_LABELS;
    exports.UNITS = UNITS;
    exports.RANGE_COLORS = RANGE_COLORS;
    exports.rangeBounds = rangeBounds;
    exports.isInWindow = isInWindow;
    exports.instanceId = instanceId;
    exports.isValidInstanceName = isValidInstanceName;
  });

  register("ui/DomSettingsCard.js", "ui", function(require, module, exports) {
    // 设置抽屉内嵌配置卡片（纯 DOM，零 React / 零 slots 依赖）。
    // 用途：即使 Cordis 的 apply/slots 注册链路在真实浏览器里不可用，也能把全部配置
    // （实例显隐勾选、增删改、全局设置）直接注入 DSH 设置抽屉的内容区，保证用户可见。
    // 数据源 = mount.js 挂载的 app（manager/controller），与面板同源。
    const { h, clear } = require("./dom.js");
    const { eventBus } = require("../core/eventBus.js");
    const { getAllAdapterTypes, ADAPTER_META } = require("../adapters/index.js");
    const { instanceId, isValidInstanceName } = require("../core/types.js");
    const { storage } = require("../core/storage.js");
    
    const CARD_CLASS = "dum-sec-card";
    const MARKER = "dum-settings-card";
    
    // 渲染整个卡片；返回根元素。manager/controller 来自 app。
    function buildSettingsCard(app) {
      const manager = app.manager;
      const controller = app.controller;
      const root = h("section", { className: "dum-sec " + CARD_CLASS, dataset: { [MARKER]: "1" } });
    
      // 0) 标题 + 说明
      root.appendChild(
        h("div", { className: "dum-sec-block" },
          h("h3", { className: "dum-sec-title" }, "涵盛达API用量查询"),
          h("p", { className: "dum-sec-desc" }, "所有改动即时生效并持久化。勾选 = 在侧边栏用量面板中显示该实例。")
        )
      );
    
      // 1) 显示哪些实例（勾选）
      const checkList = h("div", { className: "dum-sec-checks" });
      const renderChecks = () => {
        clear(checkList);
        const instances = manager.getAll();
        if (instances.length === 0) {
          checkList.appendChild(h("div", { className: "dum-sec-empty" }, "暂无实例，请先在下方添加。"));
          return;
        }
        let dragSrc = null;
        for (const inst of instances) {
          const meta = ADAPTER_META[inst.type] || { label: inst.type };
          const row = h("div", { className: "dum-sec-check", dataset: { id: inst.id } },
            h("span", { className: "dum-sec-drag", title: "拖动调整顺序", draggable: "true" }, "⠿"),
            h("input", {
              type: "checkbox",
              checked: inst.enabled ? "checked" : undefined,
              onChange: (e) => {
                manager.setEnabled(inst.id, e.target.checked);
                controller.refreshInstance(inst.id);
              }
            }),
            h("span", { className: "dum-sec-check-name" }, inst.name),
            h("span", { className: "dum-sec-check-type" }, (meta.label || inst.type) + (inst.quotaLimit ? " · 月配额 " + inst.quotaLimit : " · 无配额"))
          );
          row.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
          row.addEventListener("drop", (e) => {
            e.preventDefault();
            const targetId = inst.id;
            if (dragSrc && dragSrc !== targetId) {
              const ids = manager.getAll().map((i) => i.id);
              const from = ids.indexOf(dragSrc);
              const to = ids.indexOf(targetId);
              if (from !== -1 && to !== -1) {
                ids.splice(to, 0, ids.splice(from, 1)[0]);
                manager.reorder(ids);
              }
            }
            dragSrc = null;
          });
          const handle = row.firstChild;
          handle.addEventListener("dragstart", (e) => { dragSrc = inst.id; e.dataTransfer.setData("text/plain", inst.id); e.dataTransfer.effectAllowed = "move"; });
          handle.addEventListener("dragend", () => { dragSrc = null; });
          checkList.appendChild(row);
        }
      };
      renderChecks();
      root.appendChild(
        h("div", { className: "dum-sec-block" },
          h("div", { className: "dum-sec-block-head" },
            h("div", { className: "dum-sec-title" }, "显示哪些实例"),
            h("div", { className: "dum-sec-btns" },
              h("button", { type: "button", className: "dum-sec-btn", onClick: () => { manager.showAll(); } }, "全部显示"),
              h("button", { type: "button", className: "dum-sec-btn", onClick: () => { manager.hideAll(); } }, "全部隐藏"),
              h("button", { type: "button", className: "dum-sec-btn", onClick: () => { manager.invert(); } }, "反选")
            )
          ),
          h("p", { className: "dum-sec-hint" }, "勾选 = 在侧边栏用量面板中显示"),
          checkList
        )
      );
    
      // 2) 已有实例管理（删除）
      const listWrap = h("div", { className: "dum-sec-list" });
      const renderList = () => {
        clear(listWrap);
        const all = manager.getAll();
        if (all.length === 0) {
          listWrap.appendChild(h("div", { className: "dum-sec-empty" }, "暂无实例。"));
          return;
        }
        for (const inst of all) {
          const meta = ADAPTER_META[inst.type] || { label: inst.type };
          listWrap.appendChild(
            h("div", { className: "dum-sec-row" },
              h("span", { className: "dum-sec-row-name" }, inst.name),
              h("span", { className: "dum-sec-row-type" }, (meta.label || inst.type) + (inst.enabled ? "" : "（隐藏）")),
              h("button", {
                type: "button", className: "dum-sec-link dum-sec-danger",
                onClick: () => { if (typeof window !== "undefined" && window.confirm && !window.confirm("删除实例 " + inst.id + "？")) return; manager.remove(inst.id); }
              }, "删除")
            )
          );
        }
      };
      renderList();
      root.appendChild(
        h("div", { className: "dum-sec-block" },
          h("div", { className: "dum-sec-title" }, "已有实例"),
          h("p", { className: "dum-sec-hint" }, "实例唯一 ID = 服务商:名称"),
          listWrap
        )
      );
    
      // 3) 添加实例表单
      const types = getAllAdapterTypes();
      const fType = h("select", { className: "dum-sec-input" });
      fType.appendChild(h("option", { value: "" }, "选择服务商类型"));
      for (const t of types) {
        const meta = ADAPTER_META[t];
        fType.appendChild(h("option", { value: t }, meta ? meta.label : t));
      }
      const fName = h("input", { type: "text", placeholder: "自定义名称（如：coding-2h）", className: "dum-sec-input" });
      const quotaInput = h("input", { type: "number", min: "0", placeholder: "月配额（tokens，可选）", className: "dum-sec-input" });
      const formErr = h("div", { className: "dum-sec-error" });
      const credWrap = h("div", { className: "dum-sec-form" });
      const syncCredFields = () => {
        clear(credWrap);
        const t = fType.value;
        const meta = ADAPTER_META[t];
        if (!meta) {
          credWrap.appendChild(h("div", { className: "dum-sec-empty" }, "请先选择服务商类型"));
          return;
        }
        for (const f of meta.fields) {
          let input;
          if (f.type === "select" && Array.isArray(f.options)) {
            input = h("select", { className: "dum-sec-input", dataset: { cred: f.key } },
              f.options.map((o) => h("option", { value: o.value }, o.label || o.value)));
          } else {
            input = h("input", {
              type: f.type || "text",
              placeholder: f.label + (f.required ? "（必填）" : "（可选）"),
              className: "dum-sec-input",
              dataset: { cred: f.key }
            });
          }
          credWrap.appendChild(
            h("div", { className: "dum-sec-field" },
              h("div", { className: "dum-sec-field-label" }, f.label),
              input
            )
          );
        }
      };
      fType.addEventListener("change", () => { clear(formErr); syncCredFields(); });
      syncCredFields();
    
      const submitForm = () => {
        clear(formErr);
        const t = fType.value;
        const name = (fName.value || "").trim();
        if (!t) { formErr.textContent = "请选择服务商类型"; return; }
        if (!name) { formErr.textContent = "请输入实例名称"; return; }
        if (!isValidInstanceName(name)) { formErr.textContent = "名称只能含字母、数字、下划线、中划线（1-40 字符）"; return; }
        const creds = {};
        for (const el of credWrap.querySelectorAll("input[data-cred]")) {
          if (el.value) creds[el.dataset.cred] = el.value;
        }
        const quota = quotaInput.value ? Number(quotaInput.value) : undefined;
        try {
          manager.add({ type: t, name, credentials: creds, quotaLimit: quota });
          fName.value = "";
          quotaInput.value = "";
          syncCredFields();
        } catch (err) {
          formErr.textContent = err && err.message ? err.message : String(err);
        }
      };
    
      root.appendChild(
        h("div", { className: "dum-sec-block" },
          h("div", { className: "dum-sec-title" }, "添加实例"),
          h("p", { className: "dum-sec-hint" }, "实例唯一 ID = 服务商:名称，重名会提示冲突"),
          h("div", { className: "dum-sec-form" },
            h("div", { className: "dum-sec-field" }, h("div", { className: "dum-sec-field-label" }, "服务商类型"), fType),
            h("div", { className: "dum-sec-field" }, h("div", { className: "dum-sec-field-label" }, "实例名称"), fName),
            credWrap,
            h("div", { className: "dum-sec-field" }, h("div", { className: "dum-sec-field-label" }, "月配额"), quotaInput),
            h("div", { className: "dum-sec-form-actions" },
              h("button", { type: "button", className: "dum-sec-btn dum-sec-primary", onClick: submitForm }, "添加实例")
            ),
            formErr
          )
        )
      );
    
      // 4) 全局设置
      const g = controller.config || {};
      const intervalInput = h("input", { type: "number", min: "5", className: "dum-sec-input", value: String(Math.round((g.refreshIntervalMs || 300000) / 1000)) });
      const ratioSelect = h("select", { className: "dum-sec-input", value: g.ratioMode || "global" });
      ratioSelect.appendChild(h("option", { value: "global" }, "全局统一基准"));
      ratioSelect.appendChild(h("option", { value: "instance" }, "单实例内部基准"));
      const unitSelect = h("select", { className: "dum-sec-input", value: g.unitPreference || "tokens" });
      unitSelect.appendChild(h("option", { value: "tokens" }, "tokens"));
      unitSelect.appendChild(h("option", { value: "requests" }, "requests"));
      unitSelect.appendChild(h("option", { value: "cost" }, "cost"));
      const defaultQuotaInput = h("input", { type: "number", min: "0", className: "dum-sec-input", value: g.defaultQuotaLimit ? String(g.defaultQuotaLimit) : "" });
      const gErr = h("div", { className: "dum-sec-error" });
      const saveGlobal = () => {
        clear(gErr);
        const next = {
          refreshIntervalMs: Math.max(5, Number(intervalInput.value) || 300) * 1000,
          ratioMode: ratioSelect.value,
          unitPreference: unitSelect.value,
          defaultQuotaLimit: defaultQuotaInput.value ? Number(defaultQuotaInput.value) : undefined
        };
        try {
          controller.updateConfig(next);
          storage.setJSON("config", next);
          gErr.textContent = "已保存";
        } catch (err) {
          gErr.textContent = err && err.message ? err.message : String(err);
        }
      };
    
      root.appendChild(
        h("div", { className: "dum-sec-block" },
          h("div", { className: "dum-sec-title" }, "全局设置"),
          h("div", { className: "dum-sec-form" },
            h("div", { className: "dum-sec-field" }, h("div", { className: "dum-sec-field-label" }, "自动刷新间隔（秒，≥5）"), intervalInput),
            h("div", { className: "dum-sec-field" }, h("div", { className: "dum-sec-field-label" }, "柱长比例基准"), ratioSelect),
            h("div", { className: "dum-sec-field" }, h("div", { className: "dum-sec-field-label" }, "单位偏好"), unitSelect),
            h("div", { className: "dum-sec-field" }, h("div", { className: "dum-sec-field-label" }, "默认月配额"), defaultQuotaInput),
            h("div", { className: "dum-sec-form-actions" },
              h("button", { type: "button", className: "dum-sec-btn dum-sec-primary", onClick: saveGlobal }, "保存全局设置")
            ),
            gErr
          )
        )
      );
    
      // 事件驱动重渲染动态区块
      const disposers = ["usage-updated", "instances-changed", "config-changed"].map((ev) => eventBus.on(ev, () => { renderChecks(); renderList(); }));
      root._dumDisposers = disposers;
      return root;
    }
    
    // 清理卡片的事件订阅
    function destroySettingsCard(root) {
      if (root && root._dumDisposers) {
        for (const off of root._dumDisposers) off();
        root._dumDisposers = [];
      }
    }
    
    exports.buildSettingsCard = buildSettingsCard;
    exports.destroySettingsCard = destroySettingsCard;
  });

  register("ui/SettingsSection.js", "ui", function(require, module, exports) {
    // 设置页区块：在 DSH「设置」抽屉（sidebar.settings → settings.section 插槽）里渲染用量监控的
    // 全部配置 —— 实例显隐勾选、增删改、全局设置。用 React.createElement（无 JSX），
    // 依赖 react 平台 seed 词（由 DSH client-modules 解析）。
    //
    // !! 铁律：所有 hooks 必须无条件下、在任何 early return 之前调用。
    // 曾经把 useState 放在 "if (!ready) return" 之后 —— ready 翻转后第二次渲染的 hooks
    // 数量比第一次多，React 抛 "Rendered more hooks than during the previous render"，
    // 直接把整个设置抽屉的 React 树卸载成整页空白。
    const React = require("react");
    const { getApp } = require("./mount.js");
    const { eventBus } = require("../core/eventBus.js");
    const { storage } = require("../core/storage.js");
    const { ADAPTER_META, getAllAdapterTypes } = require("../adapters/index.js");
    const { isValidInstanceName } = require("../core/types.js");
    
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;
    
    // ---- 小组件 ----
    function Field({ label, children }) {
      return h("label", { className: "dum-sec-field" },
        h("span", { className: "dum-sec-field-label" }, label),
        children
      );
    }
    
    // ---- 主区块 ----
    function SettingsSection() {
      // 1) 全部 hooks 无条件下（顺序恒定）
      const [, force] = useState(0);
      const [ready, setReady] = useState(false);
      const [initError, setInitError] = useState("");
      const [editId, setEditId] = useState(null);
      const [fType, setFType] = useState("");
      const [fName, setFName] = useState("");
      const [fCreds, setFCreds] = useState({});
      const [fQuota, setFQuota] = useState("");
      const [fError, setFError] = useState("");
      const [settings, setSettings] = useState({});
      const dragIdRef = useRef(null);
    
      useEffect(() => {
        try {
          getApp();
          setSettings({ ...(getApp().controller.config || {}) });
          setReady(true);
        } catch (err) {
          console.warn("[dsh-HSD-usage] 设置区块初始化失败:", err);
          setInitError(err && err.message ? err.message : String(err));
        }
      }, []);
      useEffect(() => {
        const rerender = () => force((n) => n + 1);
        const offs = ["usage-updated", "instances-changed", "config-changed"].map((ev) => eventBus.on(ev, rerender));
        return () => offs.forEach((off) => off());
      }, []);
    
      // 2) 全部 hooks 之后才允许 early return / 分支渲染
      if (!ready) {
        return h("div", { className: "dum-sec" },
          h("h4", { className: "dum-sec-title dum-sec-page-title" }, "涵盛达API用量查询"),
          h("p", { className: "dum-sec-desc" }, initError
            ? "用量监控初始化失败：" + initError
            : "用量监控正在初始化…"));
      }
    
      try {
        return renderBody();
      } catch (err) {
        console.error("[dsh-HSD-usage] 设置区块渲染失败:", err);
        return h("div", { className: "dum-sec" },
          h("p", { className: "dum-sec-error" }, "用量监控设置渲染出错：" + (err && err.message ? err.message : String(err))));
      }
    
      function renderBody() {
        const app = getApp();
        const manager = app.manager;
        const controller = app.controller;
        const instances = manager.getAll();
        const meta = fType ? ADAPTER_META[fType] : null;
    
        function submit() {
          try {
            if (!isValidInstanceName(fName)) throw new Error("请输入自定义名称");
            if (!fType) throw new Error("请选择服务商类型");
            const q = fQuota !== "" && fQuota != null ? Number(fQuota) : undefined;
            if (q !== undefined && (Number.isNaN(q) || q <= 0)) throw new Error("月配额上限必须是正数");
            if (editId) {
              manager.update(editId, { name: fName, credentials: fCreds, quotaLimit: q });
            } else {
              manager.add({ type: fType, name: fName, credentials: fCreds, quotaLimit: q });
            }
            setEditId(null); setFType(""); setFName(""); setFCreds({}); setFQuota(""); setFError("");
          } catch (err) {
            setFError(err && err.message ? err.message : String(err));
          }
        }
        function startEdit(inst) {
          setEditId(inst.id);
          setFType(inst.type);
          setFName(inst.name);
          setFCreds({ ...inst.credentials });
          setFQuota(inst.quotaLimit != null ? String(inst.quotaLimit) : "");
          setFError("");
        }
        function cancelEdit() {
          setEditId(null); setFType(""); setFName(""); setFCreds({}); setFQuota(""); setFError("");
        }
        function saveSettings() {
          controller.updateConfig(settings);
          storage.setJSON("config", settings);
        }
    
        // ---- 1) 显示控制：勾选框 ----
        const visibilityHeader = h("div", { className: "dum-sec-block-head" },
          h("h4", { className: "dum-sec-title" }, "显示哪些实例"),
          h("span", { className: "dum-sec-hint" }, "勾选 = 在侧边栏用量面板中显示"),
          h("div", { className: "dum-sec-btns" },
            h("button", { className: "dum-sec-btn", onClick: () => manager.showAll() }, "全部显示"),
            h("button", { className: "dum-sec-btn", onClick: () => manager.hideAll() }, "全部隐藏"),
            h("button", { className: "dum-sec-btn", onClick: () => manager.invert() }, "反选")
          )
        );
    
        // 拖动排序：把手拖起 → 落到目标行 → 按新顺序重排
        function moveTo(srcId, targetId) {
          if (!srcId || srcId === targetId) return;
          const ids = manager.getAll().map((i) => i.id);
          const from = ids.indexOf(srcId);
          const to = ids.indexOf(targetId);
          if (from === -1 || to === -1) return;
          ids.splice(to, 0, ids.splice(from, 1)[0]);
          manager.reorder(ids);
        }
    
        const checkRows = instances.length === 0
          ? h("div", { className: "dum-sec-empty" }, "暂无实例，请先添加。")
          : instances.map((inst) =>
              h("div", {
                key: inst.id,
                className: "dum-sec-check" + (dragIdRef.current === inst.id ? " dum-dragging" : ""),
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
                onDrop: (e) => {
                  e.preventDefault();
                  const src = dragIdRef.current || e.dataTransfer.getData("text/plain");
                  moveTo(src, inst.id);
                  dragIdRef.current = null;
                }
              },
                h("span", {
                  className: "dum-sec-drag",
                  title: "拖动调整顺序",
                  draggable: true,
                  onDragStart: (e) => {
                    dragIdRef.current = inst.id;
                    e.dataTransfer.setData("text/plain", inst.id);
                    e.dataTransfer.effectAllowed = "move";
                  },
                  onDragEnd: () => { dragIdRef.current = null; }
                }, "⠿"),
                h("input", {
                  type: "checkbox",
                  checked: !!inst.enabled,
                  onChange: (e) => {
                    manager.setEnabled(inst.id, e.target.checked);
                    controller.refreshInstance(inst.id).catch(() => {});
                  }
                }),
                h("span", { className: "dum-sec-check-name", title: inst.id }, inst.name),
                h("span", { className: "dum-sec-check-type" },
                  inst.type + (inst.quotaLimit ? " · 上限 " + inst.quotaLimit : "") + (inst.enabled ? "" : " · 已隐藏")
                )
              )
            );
    
        // ---- 2) 实例增删改 ----
        const typeOptions = [h("option", { key: "t", value: "" }, "选择服务商类型")].concat(
          getAllAdapterTypes().map((t) => {
            const m = ADAPTER_META[t] || {};
            return h("option", { key: t, value: t, selected: fType === t ? "selected" : undefined }, m.label || t);
          })
        );
    
        const credFields = meta
          ? meta.fields.map((field) => {
              if (field.type === "select" && Array.isArray(field.options)) {
                const current = fCreds[field.key] || field.options[0] && field.options[0].value || "";
                return h(Field, { key: field.key, label: field.label },
                  h("select", {
                    value: current,
                    onChange: (e) => setFCreds((c) => ({ ...c, [field.key]: e.target.value }))
                  }, field.options.map((o) =>
                    h("option", { key: o.value, value: o.value, selected: current === o.value ? "selected" : undefined }, o.label || o.value)
                  ))
                );
              }
              return h(Field, { key: field.key, label: field.label },
                h("input", {
                  type: field.type === "password" ? "password" : "text",
                  value: fCreds[field.key] || "",
                  placeholder: field.required ? "必填" : "可选",
                  onChange: (e) => setFCreds((c) => ({ ...c, [field.key]: e.target.value }))
                })
              );
            })
          : [];
    
        const instanceRows = instances.map((inst) =>
          h("div", { key: inst.id, className: "dum-sec-row" },
            h("span", { className: "dum-sec-row-name", title: inst.id }, inst.name),
            h("span", { className: "dum-sec-row-type" }, inst.type),
            h("button", { className: "dum-sec-link", onClick: () => startEdit(inst) }, "编辑"),
            h("button", {
              className: "dum-sec-link dum-sec-danger",
              onClick: () => {
                if (window.confirm("删除实例「" + inst.name + "」？")) manager.remove(inst.id);
              }
            }, "删除")
          )
        );
    
        const formFields = [
          h(Field, { key: "type", label: "服务商类型" },
            h("select", { value: fType, onChange: (e) => { setFType(e.target.value); setFCreds({}); } }, typeOptions)
          ),
          h(Field, { key: "name", label: "自定义名称（用于区分多个计划）" },
            h("input", {
              type: "text",
              value: fName,
              placeholder: "如：火山方舟-Coding Plan",
              onChange: (e) => setFName(e.target.value)
            })
          ),
          ...credFields,
          h(Field, { key: "quota", label: "月配额上限（可选，满格参考）" },
            h("input", {
              type: "number",
              value: fQuota,
              placeholder: "不填则按最大用量估算",
              onChange: (e) => setFQuota(e.target.value)
            })
          )
        ];
    
        // ---- 3) 全局设置 ----
        const globalFields = [
          h(Field, { key: "interval", label: "自动刷新间隔（秒）" },
            h("input", {
              type: "number",
              value: String(Math.round((settings.refreshIntervalMs || 300000) / 1000)),
              onChange: (e) => setSettings((s) => ({ ...s, refreshIntervalMs: Math.max(10, Number(e.target.value) || 300) * 1000 }))
            })
          ),
          h(Field, { key: "ratio", label: "柱状图比例基准" },
            h("select", {
              value: settings.ratioMode || "global",
              onChange: (e) => setSettings((s) => ({ ...s, ratioMode: e.target.value }))
            },
              h("option", { value: "global" }, "全局最大值（跨实例比较）"),
              h("option", { value: "instance" }, "单实例最大值")
            )
          ),
          h(Field, { key: "unit", label: "用量单位偏好" },
            h("select", {
              value: settings.unitPreference || "tokens",
              onChange: (e) => setSettings((s) => ({ ...s, unitPreference: e.target.value }))
            },
              h("option", { value: "tokens" }, "tokens"),
              h("option", { value: "requests" }, "请求次数"),
              h("option", { value: "cost" }, "费用")
            )
          ),
          h(Field, { key: "defaultQuota", label: "默认月配额（新实例满格参考）" },
            h("input", {
              type: "number",
              value: settings.defaultQuotaLimit || "",
              onChange: (e) => setSettings((s) => ({ ...s, defaultQuotaLimit: Number(e.target.value) || null }))
            })
          )
        ];
    
        return h("div", { className: "dum-sec" },
          h("h4", { className: "dum-sec-title dum-sec-page-title" }, "涵盛达API用量查询"),
          h("p", { className: "dum-sec-desc" }, "用量监控插件的全部配置。改动即时生效并持久化到浏览器本地。"),
          h("div", { className: "dum-sec-block" },
            visibilityHeader,
            h("div", { className: "dum-sec-checks" }, checkRows)
          ),
          h("div", { className: "dum-sec-block" },
            h("div", { className: "dum-sec-block-head" },
              h("h4", { className: "dum-sec-title" }, editId ? "编辑实例" : "添加实例"),
              h("span", { className: "dum-sec-hint" }, "实例唯一 ID：type:name")
            ),
            h("div", { className: "dum-sec-list" }, instanceRows.length ? instanceRows : h("div", { className: "dum-sec-empty" }, "暂无实例。")),
            h("div", { className: "dum-sec-form" }, formFields),
            h("div", { className: "dum-sec-form-actions" },
              h("button", { className: "dum-sec-btn dum-sec-primary", onClick: submit }, editId ? "保存修改" : "添加实例"),
              editId ? h("button", { className: "dum-sec-btn", onClick: cancelEdit }, "取消编辑") : null
            ),
            fError ? h("div", { className: "dum-sec-error" }, fError) : null
          ),
          h("div", { className: "dum-sec-block" },
            h("div", { className: "dum-sec-block-head" },
              h("h4", { className: "dum-sec-title" }, "全局设置")
            ),
            h("div", { className: "dum-sec-form" }, globalFields),
            h("div", { className: "dum-sec-form-actions" },
              h("button", { className: "dum-sec-btn dum-sec-primary", onClick: saveSettings }, "保存设置")
            )
          )
        );
      }
    }
    
    // ---- 注册进 DSH 设置抽屉 ----
    // settings.section 由 ui-settings 声明，激活顺序不受约束，用 slots.inject 延迟注册。
    // 状态写入 window.__usageMonitor 供面板自检显示。
    function setDiag(key, value) {
      try { if (typeof window !== "undefined" && window.__usageMonitor) window.__usageMonitor[key] = value; } catch (e) {}
    }
    function registerSettingsSection(ctx) {
      // 轮询 ctx.get("slots")：fiber 不声明 inject 依赖（避免 PENDING 竞态导致 apply 永不执行），
      // slots 服务（由 dsh-client-runtime 提供）就绪后立刻注册「用量监控」独立标签。
      let attempts = 0;
      const tryOnce = () => {
        let slots = null;
        try { slots = ctx && typeof ctx.get === "function" ? ctx.get("slots") : null; } catch (e) {}
        if (!slots || typeof slots.inject !== "function") return false;
        try {
          slots.inject("settings.section", () => slots.register({
            name: "settings.section",
            id: "hsd-usage",
            order: 20,
            label: () => "HSD 用量监控"
          }, SettingsSection));
          setDiag("settingsSectionRegistered", true);
          setDiag("settingsSectionReason", "settings.section 已注册（独立标签）");
          console.log("[dsh-HSD-usage] settings.section 已注册（第 " + attempts + " 次尝试）");
          removeDomFallbackCard();
        } catch (err) {
          const reason = "注册抛错: " + (err && err.message ? err.message : String(err));
          console.error("[dsh-HSD-usage] " + reason);
          setDiag("settingsSectionRegistered", false);
          setDiag("settingsSectionReason", reason);
        }
        return true; // slots 已可用，停止轮询
      };
      if (tryOnce()) return;
      const timer = setInterval(() => {
        attempts += 1;
        if (tryOnce() || attempts > 300) {
          clearInterval(timer);
          if (attempts > 300) {
            const reason = "60s 内未等到 slots 服务，已由 DOM 兜底卡片接管";
            console.warn("[dsh-HSD-usage] " + reason);
            setDiag("settingsSectionRegistered", false);
            setDiag("settingsSectionReason", reason);
          }
        }
      }, 200);
    }
    
    // 插槽注册成功后，移除可能已注入的 DOM 兜底卡片，避免设置页重复出现两份配置
    function removeDomFallbackCard() {
      try {
        if (typeof document === "undefined") return;
        const cards = document.querySelectorAll("[data-dum-settings-card]");
        for (const el of cards) {
          if (el._dumDisposers) { for (const off of el._dumDisposers) off(); el._dumDisposers = []; }
          if (el.parentNode) el.parentNode.removeChild(el);
        }
      } catch (e) {}
    }
    
    exports.SettingsSection = SettingsSection;
    exports.registerSettingsSection = registerSettingsSection;
  });

  register("ui/Toolbar.js", "ui", function(require, module, exports) {
    // 工具栏：只读展示，仅保留刷新。管理操作移入 设置 → 用量监控。
    const { h } = require("./dom.js");
    
    function Toolbar({ onRefresh, refreshing }) {
      return h(
        "div",
        { className: "dum-toolbar" },
        h("button", { className: "dum-btn", onClick: onRefresh }, refreshing ? "刷新中…" : "刷新")
      );
    }
    
    exports.Toolbar = Toolbar;
  });

  register("ui/UsageBar.js", "ui", function(require, module, exports) {
    // 单个实例：紧凑单行布局 —— [套餐徽标] 名称 [5h蓝色粗柱（值在柱内）] ⟳
    // 悬停该行：下方展开 周/月 细柱 + 完整 tooltip。整体高度 = 实例数 × 一行。
    // baseline 由 UsagePanel.baselineFor 计算：百分比数据=100，token 数据=全局基准。
    const { h } = require("./dom.js");
    const { RANGE_LABELS, RANGE_COLORS } = require("../core/types.js");
    const { formatUsage, barWidth } = require("../utils/formatters.js");
    const { formatClock, formatFull } = require("../utils/time.js");
    const { providerLogo } = require("./logos.js");
    
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
    
    function UsageBar({ instance, usage, baseline, onRefreshOne }) {
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
    
    exports.UsageBar = UsageBar;
  });

  register("ui/UsagePanel.js", "ui", function(require, module, exports) {
    // 主面板：只读展示实例条形柱 + 刷新。所有配置（含显隐勾选、增删改、全局设置）
    // 都在 DSH「设置 → 用量监控」区块（见 SettingsSection.js）。
    const { h, clear } = require("./dom.js");
    const { Toolbar } = require("./Toolbar.js");
    const { UsageBar } = require("./UsageBar.js");
    const { eventBus } = require("../core/eventBus.js");
    const { TIME_RANGES } = require("../core/types.js");
    
    class UsagePanel {
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
    
    exports.UsagePanel = UsagePanel;
  });

  register("ui/dom.js", "ui", function(require, module, exports) {
    // 轻量 DOM 构建助手（纯 DOM，零依赖）
    function h(tag, attrs = {}, ...children) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === "className") el.className = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k === "html") el.innerHTML = v;
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
      }
      for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        el.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
      }
      return el;
    }
    
    function clear(el) {
      while (el.firstChild) el.removeChild(el.firstChild);
      return el;
    }
    
    function injectStyle(id, css) {
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
    
    exports.h = h;
    exports.clear = clear;
    exports.injectStyle = injectStyle;
  });

  register("ui/logos.js", "ui", function(require, module, exports) {
    // 供应商小 logo（内联 SVG，按品牌色 16px 圆角标）
    // 说明：离线环境拿不到官方矢量素材，用品牌色 + 首字/首字母的圆角标近似：
    //   火山方舟 → 品牌红橙 #FF4A00 + "火"；智谱 → 品牌蓝紫 #3859FF + "Z"；DeepSeek → 品牌蓝 #4D6BFE + 鲸鱼曲线
    const badge = (bg, inner) =>
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<rect x="1" y="1" width="22" height="22" rx="6" fill="' + bg + '"/>' + inner + '</svg>';
    
    const LOGOS = {
      volcano: badge("#FF4A00",
        '<text x="12" y="17.2" font-size="13" font-weight="700" fill="#fff" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, sans-serif">火</text>'),
      zhipu: badge("#3859FF",
        '<text x="12" y="17.5" font-size="14" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">Z</text>'),
      deepseek: badge("#4D6BFE",
        '<path d="M6 15.5c0-4 2.6-7 6.5-7 2.2 0 3.9 1 4.8 2.6l1.7-1v6.4l-1.7-1c-.9 1.6-2.6 2.6-4.8 2.6H8.6c-.9 0-1.6-.4-2.1-1l1-1.2z" fill="#fff"/>' +
        '<circle cx="15.2" cy="11.6" r=".9" fill="#4D6BFE"/>')
    };
    
    // 未收录的类型：灰底 + 类型首字母
    function providerLogo(type) {
      const svg = LOGOS[type];
      if (svg) return svg;
      const letter = String(type || "?").charAt(0).toUpperCase();
      return badge("#8a8f98",
        '<text x="12" y="17" font-size="13" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">' + letter + '</text>');
    }
    
    exports.providerLogo = providerLogo;
  });

  register("ui/mount.js", "ui", function(require, module, exports) {
    // GUI 挂载：把用量面板挂到侧边栏"设置区域上方"，并监听模型切换。
    // 挂载策略：
    //  1) 注入样式
    //  2) 找到设置区域锚点（settingsArea/footArea/sidebar）
    //  3) 在锚点之前插入面板
    //  4) 找不到时用 MutationObserver 重试（GUI 客户端渲染）
    //  5) 模型切换：监听模型名元素文本变化，变化即触发映射实例刷新
    const { injectStyle } = require("./dom.js");
    const { CSS } = require("./styles.js");
    const { UsagePanel } = require("./UsagePanel.js");
    const { InstanceManager } = require("../core/InstanceManager.js");
    const { Controller } = require("../core/Controller.js");
    const { storage } = require("../core/storage.js");
    const { eventBus } = require("../core/eventBus.js");
    const { getAdapter, getAllAdapterTypes } = require("../adapters/index.js");
    const { buildSettingsCard, destroySettingsCard } = require("./DomSettingsCard.js");
    
    let mounted = false;
    let app = null;
    
    function createApp(options = {}) {
      const manager = options.manager || new InstanceManager({ storage: options.storage || storage });
      const controller = options.controller || new Controller({
        manager,
        adapters: getAdapter,
        localSource: options.localSource || null,
        ...options.controllerOptions
      });
      // 载入持久化的全局配置
      const savedConfig = storage.getJSON("config", null);
      if (savedConfig) controller.updateConfig(savedConfig);
      controller.start();
      return { manager, controller };
    }
    
    function getApp() {
      if (!app) app = createApp();
      return app;
    }
    
    function findAnchor() {
      return (
        document.querySelector('[class*="settingsArea"]') ||
        document.querySelector('[class*="footArea"]') ||
        document.querySelector('[class*="sidebar"]') ||
        null
      );
    }
    
    function insertPanel(panelRoot) {
      const anchor = findAnchor();
      if (!anchor) return false;
      const parent = anchor.parentNode;
      if (!parent) return false;
      if (panelRoot.parentNode) panelRoot.parentNode.removeChild(panelRoot);
      parent.insertBefore(panelRoot, anchor);
      return true;
    }
    
    function mountPanel(options = {}) {
      if (mounted) return getApp();
      const appCfg = createApp(options);
      app = appCfg;
      let panel = null;
    
      if (typeof document !== "undefined") {
        injectStyle("dsh-usage-monitor-styles", CSS);
        try {
          panel = new UsagePanel(appCfg);
          const panelRoot = panel.mount();
          panelRoot.style.display = "none";
    
          const tryMount = () => {
            if (insertPanel(panelRoot)) {
              panelRoot.style.display = "";
              return true;
            }
            return false;
          };
    
          if (document.body) {
            if (!tryMount()) {
              let attempts = 0;
              const timer = setInterval(() => {
                attempts += 1;
                if (tryMount() || attempts > 300) { // ~30s 上限
                  clearInterval(timer);
                }
              }, 100);
            }
          }
          startModelWatcher(appCfg.controller);
          setupSettingsCardFallback(appCfg);
        } catch (err) {
          console.error("[dsh-HSD-usage] UI 挂载失败:", err);
        }
      }
    
      // 暴露调试/外部 API（无论是否在浏览器）
      if (typeof window !== "undefined") {
        window.__usageMonitor = {
          manager: appCfg.manager,
          controller: appCfg.controller,
          refresh: (id) => appCfg.controller.manualRefresh(id),
          panel,
          applyRan: false,
          settingsSectionRegistered: undefined,
          settingsSectionReason: ""
        };
      }
      mounted = true;
      return appCfg;
    }
    
    // ---- 设置抽屉内嵌配置卡片（DOM 兜底） ----
    // 不依赖 apply/slots：直接观察 DSH 设置抽屉（role=dialog 含 nav），把配置卡片插到
    // 内容列（.header 与 .options 之间，React 不管理该层兄弟节点，不会被清掉）。
    // 仅当 slots 注册成功（settingsSectionRegistered===true）时跳过，避免重复。
    let settingsCardRoot = null;
    let settingsCardObserver = null;
    
    function setupSettingsCardFallback(appCfg) {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
      if (settingsCardObserver) return;
      settingsCardObserver = new MutationObserver(() => {
        try { injectSettingsCard(appCfg); } catch (err) { console.error("[dsh-HSD-usage] 设置卡片注入失败:", err); }
      });
      settingsCardObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
      // 立即试一次（抽屉可能已打开）
      try { injectSettingsCard(appCfg); } catch (err) { console.error("[dsh-HSD-usage] 设置卡片注入失败:", err); }
    }
    
    function injectSettingsCard(appCfg) {
      const w = typeof window !== "undefined" ? window : null;
      if (w && w.__usageMonitor && w.__usageMonitor.settingsSectionRegistered === true) return;
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog) return;
      if (!dialog.querySelector('[class*="nav"], [class*="Nav"]')) return; // 确认是设置抽屉
      const options = dialog.querySelector('[class*="options"]');
      if (!options) return;
      const column = options.parentNode;
      if (!column || column.querySelector("[data-dum-settings-card]")) return;
      if (settingsCardRoot && !settingsCardRoot.parentNode) {
        destroySettingsCard(settingsCardRoot);
        settingsCardRoot = null;
      }
      if (!settingsCardRoot) settingsCardRoot = buildSettingsCard(appCfg);
      column.insertBefore(settingsCardRoot, options);
    }
    
    // ---- 模型切换监听 ----
    // 通过 MutationObserver 观察 body 中模型名元素文本变化；变化即触发相关实例刷新。
    function startModelWatcher(controller) {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
      let lastModel = captureModelName();
      const observer = new MutationObserver(() => {
        const nowModel = captureModelName();
        if (nowModel && nowModel !== lastModel) {
          lastModel = nowModel;
          controller.onModelChanged(nowModel);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    
    function captureModelName() {
      // 1) 优先找"模型座位/选择器"相关区域
      const candidates = document.querySelectorAll('[class*="model"],[class*="Model"],[data-role*="model"]');
      for (const el of candidates) {
        const text = (el.textContent || "").trim();
        // 过滤掉太长的内容（避免命中对话内容）
        if (text.length > 0 && text.length <= 80 && looksLikeModelName(text)) return text;
      }
      // 2) 兜底：扫描可见短文本中的已知模型片段
      const known = ["deepseek", "glm", "kimi", "qwen", "gpt", "claude", "flash", "pro", "mini", "max"];
      for (const el of candidates) {
        const text = (el.textContent || "").trim();
        if (text && text.length <= 80 && known.some((k) => text.toLowerCase().includes(k))) return text;
      }
      return null;
    }
    
    function looksLikeModelName(text) {
      // 模型名通常是一段小写标识符，可含 "-"、"."、"/"、数字
      return /^[a-zA-Z0-9._\-\/\s]{1,80}$/.test(text) && /[a-zA-Z]/.test(text);
    }
    
    exports.createApp = createApp;
    exports.getApp = getApp;
    exports.mountPanel = mountPanel;
  });

  register("ui/styles.js", "ui", function(require, module, exports) {
    // 组件样式：使用 DeepSeekHarness 主题 CSS 变量（与真实主题一致，含兜底值）。
    // 注意：浅色主题下 --dsw-alias-label-primary 是深色，背景必须用同族变量，否则深底深字看不见。
    const CSS = `
    .dum-root {
      --dum-blue: #4A90E2;
      --dum-green: #50C878;
      --dum-orange: #FF8C42;
      box-sizing: border-box;
      width: 100%;
      padding: 8px 10px 10px;
      margin: 0 0 8px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));
      border-radius: 10px;
      background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-size: 12px;
      line-height: 1.4;
      font-family: var(--ds-font-family-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    .dum-root * { box-sizing: border-box; }
    .dum-root .dum-toolbar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .dum-root .dum-btn {
      border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
      background: var(--dsw-alias-button-elevated-fill, rgba(128,128,128,.08));
      color: var(--dsw-alias-label-primary, inherit);
      border-radius: 6px;
      font-size: 11px;
      line-height: 1;
      padding: 5px 8px;
      cursor: pointer;
      white-space: nowrap;
    }
    .dum-root .dum-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16)); }
    
    .dum-root .dum-item { position: relative; padding: 4px 0; }
    .dum-root .dum-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .dum-root .dum-logo { flex: none; width: 15px; height: 15px; border-radius: 4px; overflow: hidden; display: inline-flex; }
    .dum-root .dum-logo svg { width: 100%; height: 100%; display: block; }
    .dum-root .dum-name { flex: none; max-width: 40%; font-weight: 600; font-size: 11px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    
    .dum-root .dum-main .dum-bar-row.dum-bar-main { flex: 1 1 auto; min-width: 0; }
    .dum-root .dum-refresh-one { flex: none; background: none; border: none; color: var(--dsw-alias-label-secondary,#666); cursor: pointer; font-size: 12px; padding: 0 2px; }
    .dum-root .dum-refresh-one:hover { color: var(--dsw-alias-label-primary,#1f2328); }
    
    /* 周/月细柱行：默认隐藏，悬停实例行时展开 */
    .dum-root .dum-alt-rows { display: none; flex-direction: column; gap: 3px; padding: 3px 0 2px 24px; }
    .dum-root .dum-item:hover .dum-alt-rows { display: flex; }
    .dum-root .dum-alt-label { flex: none; width: 18px; font-size: 10px; opacity: .7; text-align: right; }
    
    .dum-root .dum-bar-row { position: relative; display: flex; align-items: center; min-width: 0; }
    .dum-root .dum-bar {
      position: relative;
      height: 14px;
      border-radius: 3px;
      min-width: 0;
      overflow: hidden;
      transition: width .35s ease;
      background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));
    }
    .dum-root .dum-bar.dum-thin { height: 7px; }
    .dum-root .dum-bar.dum-na { background: #888; opacity: .55; }
    .dum-root .dum-bar-fill { position: absolute; inset: 0; opacity: .9; }
    .dum-root .dum-bar-value {
      position: relative;
      padding: 0 5px;
      font-size: 10px;
      color: var(--dsw-alias-label-primary, #1f2328);
      white-space: nowrap;
      line-height: 14px;
      text-shadow: 0 1px 2px rgba(255,255,255,.35);
      display: flex; align-items: center;
    }
    .dum-root .dum-bar.dum-thin .dum-bar-value { line-height: 7px; font-size: 9px; }
    .dum-root .dum-bar.dum-na .dum-bar-value { color: #eee; text-shadow: none; }
    .dum-root .dum-bar-label { margin-left: 6px; font-size: 10px; opacity: .75; flex: none; }
    
    .dum-root .dum-loading { text-align: center; opacity: .6; padding: 6px 0; font-size: 11px; }
    .dum-root .dum-status { margin-top: 6px; padding-top: 5px; border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.2)); font-size: 10px; opacity: .55; }
    
    /* 悬停提示 */
    .dum-root .dum-tooltip {
      visibility: hidden; opacity: 0;
      position: absolute; left: 0; right: 0; top: calc(100% + 4px);
      z-index: 999;
      background: var(--dsw-alias-bg-layer-3, #fff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
      border-radius: 8px;
      padding: 8px 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,.35);
      transition: opacity .15s ease;
      pointer-events: none;
      font-size: 11px;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .dum-root .dum-item:hover .dum-tooltip { visibility: visible; opacity: 1; }
    .dum-root .dum-tooltip-title { font-weight: 600; margin-bottom: 4px; }
    .dum-root .dum-tooltip-row { display: flex; justify-content: space-between; gap: 12px; padding: 1px 0; }
    .dum-root .dum-tooltip-note { opacity: .7; margin-top: 4px; font-size: 10px; }
    
    /* ---- 设置页区块（渲染在 DSH 设置抽屉内，随主题） ---- */
    .dum-sec { display: flex; flex-direction: column; gap: 18px; }
    .dum-sec-desc { margin: 0; font-size: 13px; opacity: .75; }
    .dum-sec-block { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); padding-top: 14px; }
    .dum-sec-block-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .dum-sec-title { margin: 0; font-size: 14px; font-weight: 600; }
    .dum-sec-page-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .dum-sec-hint { font-size: 12px; opacity: .6; }
    .dum-sec-btns { display: flex; gap: 6px; margin-left: auto; }
    .dum-sec-btn {
      border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
      background: var(--dsw-alias-button-elevated-fill, rgba(128,128,128,.08));
      color: var(--dsw-alias-label-primary, inherit);
      border-radius: 6px;
      font-size: 12px;
      line-height: 1;
      padding: 6px 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .dum-sec-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16)); }
    .dum-sec-btn.dum-sec-primary { background: var(--dsw-alias-button-primary-fill, #4A90E2); color: var(--dsw-alias-label-primary-inverted, #fff); border-color: transparent; }
    
    .dum-sec-checks { display: flex; flex-direction: column; gap: 6px; }
    .dum-sec-check { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); cursor: pointer; }
    .dum-sec-check:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }
    .dum-sec-check input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--dsw-alias-brand-primary, #4A90E2); cursor: pointer; }
    .dum-sec-drag { flex: none; cursor: grab; opacity: .45; font-size: 13px; line-height: 1; user-select: none; padding: 0 1px; }
    .dum-sec-drag:hover { opacity: 1; }
    .dum-sec-check.dum-dragging { opacity: .45; }
    .dum-sec-check-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dum-sec-check-type { font-size: 11px; opacity: .65; margin-left: auto; flex: none; }
    
    .dum-sec-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .dum-sec-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.05)); }
    .dum-sec-row-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dum-sec-row-type { font-size: 11px; opacity: .65; flex: none; }
    .dum-sec-link { background: none; border: none; color: var(--dsw-alias-brand-primary, #4A90E2); cursor: pointer; font-size: 12px; padding: 2px 4px; }
    .dum-sec-danger { color: var(--dsw-alias-state-error-primary, #e5534b); }
    
    .dum-sec-form { display: flex; flex-direction: column; gap: 8px; }
    .dum-sec-input {
      box-sizing: border-box;
      width: 100%;
      padding: 7px 9px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-primary, #1f2328);
      font-size: 13px;
      font-family: inherit;
    }
    .dum-sec-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .dum-sec-field-label { opacity: .8; }
    .dum-sec-field input, .dum-sec-field select {
      box-sizing: border-box;
      width: 100%;
      padding: 7px 9px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-primary, #1f2328);
      font-size: 13px;
      font-family: inherit;
    }
    .dum-sec-form-actions { display: flex; gap: 8px; margin-top: 10px; }
    .dum-sec-error { color: var(--dsw-alias-state-error-primary, #e5534b); font-size: 12px; margin-top: 8px; }
    .dum-sec-empty { opacity: .6; font-size: 12px; padding: 4px 0; }
    `;
    
    exports.CSS = CSS;
  });

  register("utils/crypto.js", "utils", function(require, module, exports) {
    // 跨环境 SHA-256 / HMAC-SHA256（浏览器 crypto.subtle，Node 回退 node:crypto）
    function toBytes(data) {
      return typeof data === "string" ? new TextEncoder().encode(data) : data;
    }
    
    function hex(buf) {
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    
    async function nodeCrypto() {
      return import("node:crypto");
    }
    
    async function sha256Hex(data) {
      if (globalThis.crypto && globalThis.crypto.subtle) {
        const buf = await globalThis.crypto.subtle.digest("SHA-256", toBytes(data));
        return hex(buf);
      }
      const { createHash } = await nodeCrypto();
      return createHash("sha256").update(toBytes(data)).digest("hex");
    }
    
    async function hmacSha256Hex(key, data) {
      if (globalThis.crypto && globalThis.crypto.subtle) {
        const k = await globalThis.crypto.subtle.importKey("raw", toBytes(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sig = await globalThis.crypto.subtle.sign("HMAC", k, toBytes(data));
        return hex(sig);
      }
      const { createHmac } = await nodeCrypto();
      return createHmac("sha256", toBytes(key)).update(toBytes(data)).digest("hex");
    }
    
    // 原始字节链式 HMAC：火山签名要求每一层派生用上一层的「原始字节」做 key，
    // 而不是 hex 字符串（hex 字符串当 UTF-8 文本会得到完全不同的签名）。
    async function hmacSha256Bytes(key, data) {
      if (globalThis.crypto && globalThis.crypto.subtle) {
        const k = await globalThis.crypto.subtle.importKey("raw", toBytes(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sig = await globalThis.crypto.subtle.sign("HMAC", k, toBytes(data));
        return new Uint8Array(sig);
      }
      const { createHmac } = await nodeCrypto();
      return new Uint8Array(createHmac("sha256", toBytes(key)).update(toBytes(data)).digest());
    }
    
    exports.sha256Hex = sha256Hex;
    exports.hmacSha256Hex = hmacSha256Hex;
    exports.hmacSha256Bytes = hmacSha256Bytes;
  });

  register("utils/formatters.js", "utils", function(require, module, exports) {
    // 数值格式化
    // 1000 -> "1.0K"，1_200_000 -> "1.2M"，单位追加为 "1.2M tokens"
    function formatNumber(n) {
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
    
    function formatUsage(value, unit = "tokens") {
      if (value == null || Number.isNaN(value)) return "N/A";
      if (unit === "%") return `${Math.round(value)}%`;
      const label = unit === "tokens" ? "tokens" : unit === "requests" ? "次请求" : unit === "cost" ? "元" : unit;
      return `${formatNumber(value)} ${label}`;
    }
    
    // 百分比宽度（0-100），支持 null
    function barWidth(value, max) {
      if (value == null || !max || max <= 0) return 0;
      return Math.max(0, Math.min(100, (value / max) * 100));
    }
    
    exports.formatNumber = formatNumber;
    exports.formatUsage = formatUsage;
    exports.barWidth = barWidth;
  });

  register("utils/time.js", "utils", function(require, module, exports) {
    // 时间工具
    const { rangeBounds, isInWindow } = require("../core/types.js");
    
    
    
    // 精确到分钟的刷新时间，如 "14:32"
    function formatClock(ts) {
      if (!ts) return "—";
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    
    function formatFull(ts) {
      if (!ts) return "—";
      const d = new Date(ts);
      const MM = String(d.getMonth() + 1).padStart(2, "0");
      const DD = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${MM}-${DD} ${formatClock(ts)}`;
    }
    
    exports.rangeBounds = rangeBounds;
    exports.isInWindow = isInWindow;
    exports.formatClock = formatClock;
    exports.formatFull = formatFull;
  });

      // 入口：apply(ctx) 由 DSH 客户端内核在插件激活时调用（web shell runPluginBoot）
      const __outerRequire = require;
      const { mountPanel } = requireFrom("")("ui/mount.js");
      const { registerSettingsSection } = requireFrom("")("ui/SettingsSection.js");
      // 不声明服务依赖：避免纤维因等待 slots 而 PENDING（apply 永不执行）。
      // 设置区块注册改用 ctx.get("slots")，无需 inject 声明。
      const inject = [];
      function apply(ctx) {
        console.log("[dsh-HSD-usage] apply 被调用，ctx 服务: slots=" + typeof (ctx && ctx.get ? ctx.get("slots") : "?"));
        try { mountPanel({}); } catch (err) { console.error("[dsh-HSD-usage] 挂载失败:", err); }
        try { if (typeof window !== "undefined" && window.__usageMonitor) window.__usageMonitor.applyRan = true; } catch {}
        try { registerSettingsSection(ctx); } catch (err) { console.error("[dsh-HSD-usage] 设置区块注册失败:", err); }
      }
      exports.apply = apply;
      exports.inject = inject;
      exports.mountPanel = mountPanel;
      exports.registerSettingsSection = registerSettingsSection;
      try {
        mountPanel({});
      } catch (err) {
        console.error("[dsh-HSD-usage] 挂载失败:", err);
      }
      console.log("[dsh-HSD-usage] factory 执行完成 rev=732d12664a");
      try { if (typeof window !== "undefined" && window.__usageMonitor) window.__usageMonitor.buildRev = "732d12664a"; } catch {}
      return module.exports;
    }
  });
})();
