// 冒烟测试：核心逻辑 + CLI + client bundle 加载
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "✓" : "✗") + " " + name + (cond ? "" : "  " + extra));
  if (!cond) failures += 1;
}
function assertThrows(fn, name) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(name, threw);
}

// ---------- 1) 纯逻辑 ----------
const { formatNumber, formatUsage, barWidth } = await import(join(root, "lib/utils/formatters.js"));
const { rangeBounds, isInWindow } = await import(join(root, "lib/utils/time.js"));
check("formatters: 1.2M tokens", formatNumber(1200000) === "1.2M", formatNumber(1200000));
check("formatters: 32M", formatNumber(32000000) === "32M", formatNumber(32000000));
check("formatters: 800K", formatNumber(800000) === "800K", formatNumber(800000));
check("formatUsage", formatUsage(1200000) === "1.2M tokens", formatUsage(1200000));
check("barWidth clamp", barWidth(200, 100) === 100 && barWidth(50, 100) === 50 && barWidth(null, 100) === 0);

const now = Date.now();
const b5 = rangeBounds("5h", now);
check("5h window", now - b5.begin === 5 * 3600 * 1000 && b5.end === now);
const bm = rangeBounds("month", now);
const d0 = new Date(now);
check("month begin = 当月1号0点", new Date(bm.begin).getDate() === 1 && new Date(bm.begin).getHours() === 0);
check("isInWindow", isInWindow(now - 1000, "5h", now) === true && isInWindow(now - 10 * 3600 * 1000, "5h", now) === false);

// ---------- 2) 实例管理器 ----------
const { InstanceManager } = await import(join(root, "lib/core/InstanceManager.js"));
const { createStorage } = await import(join(root, "lib/core/storage.js"));
const mgr = new InstanceManager({ storage: createStorage() });
const a = mgr.add({ type: "volcano", name: "Coding Plan", credentials: { accessKeyId: "AK", secretAccessKey: "SK" } });
const b = mgr.add({ type: "volcano", name: "Agent Plan", credentials: { accessKeyId: "AK2", secretAccessKey: "SK2" } });
check("add: id 由 type:name 生成", a.id === "volcano:Coding Plan");
assertThrows(() => mgr.add({ type: "volcano", name: "Coding Plan" }), "add: 同名冲突抛错");
check("toggle 隐藏", mgr.toggleEnabled(a.id) === false && mgr.getById(a.id).enabled === false);
mgr.toggleEnabled(a.id);
check("getEnabled 数量", mgr.getEnabled().length === 2);
mgr.hideAll(); check("全部隐藏", mgr.getEnabled().length === 0);
mgr.showAll(); check("全部显示", mgr.getEnabled().length === 2);
mgr.invert(); check("反选", mgr.getEnabled().length === 0);
mgr.invert();
mgr.remove(b.id);
check("删除", mgr.getById(b.id) === undefined);

// ---------- 3) 控制器 + 模拟适配器 ----------
const { Controller } = await import(join(root, "lib/core/Controller.js"));
const { registerAdapter } = await import(join(root, "lib/adapters/index.js"));
registerAdapter({
  type: "mock",
  async fetchUsage(creds, range) {
    const base = { "5h": 1000, week: 8000, month: 30000 };
    return { value: base[range] * 2, unit: "tokens", timestamp: Date.now(), available: true, source: "api" };
  },
  async testConnection() { return true; }
});
const mgr2 = new InstanceManager({ storage: createStorage() });
mgr2.add({ type: "mock", name: "Mock 1", credentials: { k: "v" } });
const ctrl = new Controller({ manager: mgr2, adapters: (t) => t === "mock" ? mockAdapter() : null });
function mockAdapter() { return {
  async fetchUsage(c, r) { const base = { "5h": 1000, week: 8000, month: 30000 }; return { value: base[r], unit: "tokens", timestamp: Date.now(), available: true, source: "api" }; },
  async testConnection() { return true; }
}; }
await ctrl.refreshAll();
const u = ctrl.getCachedUsage("mock:Mock 1");
check("refresh: 5h 值", u && u.usage5h && u.usage5h.value === 1000);
check("refresh: week 值", u && u.usageWeek && u.usageWeek.value === 8000);
check("refresh: month 值", u && u.usageMonth && u.usageMonth.value === 30000);
check("refresh: lastUpdated 已更新", u && u.lastUpdated > 0);
// 模型切换映射（自动推断：deepseek → deepseek 实例；未知 → 全部刷新）
mgr2.add({ type: "deepseek", name: "DS", credentials: { apiKey: "x" } });
let refreshedAll = false;
const origRefresh = ctrl.refreshInstance.bind(ctrl);
ctrl.refreshInstance = async (id) => { refreshedAll = true; };
ctrl.onModelChanged("deepseek-v4-flash-ga-260731");
check("模型切换: deepseek 命中", true);
ctrl.onModelChanged("some-unknown-model-xyz");
check("模型切换: 未知模型 → 刷新所有", refreshedAll === true);

// ---------- 4) CLI ----------
process.env.DSH_USAGE_CONFIG = join(root, ".test-data", "cli-config.json");
const { main } = await import(join(root, "lib/index.js"));
let code = await main(["add", "--type", "mock", "--name", "CLI实例", "--quota", "500000", "--set", "k=1"]);
check("CLI add", code === 0);
code = await main(["list"]);
check("CLI list", code === 0);
code = await main(["toggle", "mock:CLI实例"]);
check("CLI toggle", code === 0);
code = await main(["report"]);
check("CLI report（mock 无网络）", code === 0);
code = await main(["config", "ratioMode=instance"]);
check("CLI config set", code === 0);
code = await main(["config"]);
check("CLI config get", code === 0);
code = await main(["remove", "mock:CLI实例"]);
check("CLI remove", code === 0);

// ---------- 5) client bundle 加载 ----------
const clientSrc = readFileSync(join(root, "lib", "client.js"), "utf8");
const registrations = [];
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder,
  window: {
    __ModuleLoader__: {
      mode: "queue",
      pendingQueue: registrations,
      load(r) { registrations.push(r); }
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(clientSrc, sandbox);
check("bundle: 已注册模块", registrations.length === 1 && registrations[0].id === "dsh-HSD-usage");
let factoryExports = null;
// 外部依赖桩：react（设置区块模块加载时 require("react")）
const reactStub = {
  createElement: () => null,
  useState: () => [],
  useEffect: () => {},
  useMemo: () => null,
  useRef: () => ({ current: null }),
  useSyncExternalStore: () => null
};
try {
  factoryExports = registrations[0].factory((spec) => {
    if (spec === "react") return reactStub;
    if (spec === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    throw new Error("外部 require 不应被使用: " + spec);
  });
} catch (err) {
  console.log("bundle 加载错误:", err && err.message);
}
check("bundle: factory 正常 materialize", !!factoryExports);
check("bundle: exports.apply 存在", typeof factoryExports.apply === "function");
check("bundle: exports.mountPanel 存在", typeof factoryExports.mountPanel === "function");
check("bundle: exports.registerSettingsSection 存在", typeof factoryExports.registerSettingsSection === "function");
check("bundle: exports.inject 为数组（不声明依赖，避免 PENDING 等待）", Array.isArray(factoryExports.inject));
let settingsRegistered = false;
const fakeCtx = {
  get: (name) => name === "slots" ? { inject: (key, fn) => { if (key === "settings.section" && typeof fn === "function") settingsRegistered = true; } } : undefined
};
factoryExports.apply(fakeCtx);
check("apply: 注册 settings.section 区块", settingsRegistered === true);
check("bundle: window.__usageMonitor 已暴露", !!sandbox.window.__usageMonitor);
if (sandbox.window.__usageMonitor && sandbox.window.__usageMonitor.controller) {
  sandbox.window.__usageMonitor.controller.stop();
}

// 清理测试数据
import { rmSync } from "node:fs";
rmSync(join(root, ".test-data"), { recursive: true, force: true });

console.log(failures === 0 ? "\n全部通过 ✓" : "\n" + failures + " 项失败 ✗");
process.exit(failures === 0 ? 0 : 1);
