// 适配器基类：统一 UsageProviderAdapter 接口 + 公共辅助
// UsageData = { value, unit, timestamp, available, source?, reason?, meta? }
export class BaseAdapter {
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
