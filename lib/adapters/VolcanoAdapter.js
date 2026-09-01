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
import { BaseAdapter } from "./BaseAdapter.js";
import { sha256Hex, hmacSha256Hex, hmacSha256Bytes } from "../utils/crypto.js";

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

export class VolcanoAdapter extends BaseAdapter {
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
