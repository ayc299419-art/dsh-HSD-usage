// 本地用量估算：读取 DeepSeekHarness 的会话投影缓存（~/.dsh/storages/session_projcache.json），
// 按 5h / 周 / 月 窗口聚合 token 用量，作为服务商 API 不可用时的兜底估算。
// 仅 Node 环境使用（fs 访问），不会被内联进浏览器 client bundle。
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { rangeBounds, isInWindow } from "./types.js";

function tokenTotals(val) {
  const t = val && val.totals ? val.totals : {};
  return {
    input: t.uncachedInputTokens || 0,
    cacheRead: t.cacheReadTokens || 0,
    cacheWrite: t.cacheWriteTokens || 0,
    output: t.outputTokens || 0
  };
}

export class LocalUsageSource {
  constructor(options = {}) {
    const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
    this.cachePath = options.cachePath || process.env.DSH_USAGE_LOCAL_CACHE || join(dshHome, "storages", "session_projcache.json");
    this.parsed = null;
    this.lastLoaded = 0;
  }

  async load(force = false) {
    const now = Date.now();
    if (!force && this.parsed && now - this.lastLoaded < 30000) return this.parsed;
    try {
      const text = await readFile(this.cachePath, "utf8");
      this.parsed = JSON.parse(text);
      this.lastLoaded = now;
    } catch (err) {
      this.parsed = null;
      this.lastLoaded = now;
      this.error = err;
    }
    return this.parsed;
  }

  // 汇总所有会话在指定窗口内的 token 总量
  async aggregate(range, now = Date.now()) {
    const data = await this.load();
    if (!data || !data.tables || !data.tables.sessions) return null;
    const { begin, end } = rangeBounds(range, now);
    let input = 0, cacheRead = 0, cacheWrite = 0, output = 0, sessions = 0;
    for (const session of Object.values(data.tables.sessions)) {
      const tokenUsage = session && session.rows && session.rows.tokenUsage;
      if (!tokenUsage || !tokenUsage.val) continue;
      const created = session.identity && session.identity.createdAt;
      // 会话创建时间在窗口内才计入（近似：仅能按会话粒度估算）
      if (!created || created < begin || created > end) continue;
      const t = tokenTotals(tokenUsage.val);
      input += t.input; cacheRead += t.cacheRead; cacheWrite += t.cacheWrite; output += t.output;
      sessions += 1;
    }
    return { input, cacheRead, cacheWrite, output, sessions };
  }

  // 返回该窗口的估算值（tokens）
  async estimate(range, now = Date.now()) {
    const agg = await this.aggregate(range, now);
    if (!agg) return null;
    return agg.input + agg.output + agg.cacheRead + agg.cacheWrite;
  }
}
