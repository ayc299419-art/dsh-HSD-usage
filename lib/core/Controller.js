// 核心控制器：数据聚合、调度、缓存、事件监听。
// 职责：
//  - 遍历启用实例，调用适配器获取 5h / 周 / 月 用量
//  - 适配器失败时，若配置了本地估算则回退估算（标记 source=estimate），否则标记不可用
//  - 定时自动刷新（默认 300s，可配）
//  - 监听模型切换事件（onModelChanged），刷新映射实例
//  - 以实例 ID 为键缓存 InstanceUsage，并广播 usage-updated 事件
import { TIME_RANGES } from "./types.js";
import { eventBus } from "./eventBus.js";
import { getAdapter } from "../adapters/index.js";

const DEFAULT_INTERVAL = 5 * 60 * 1000; // 默认 5 分钟

export class Controller {
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
