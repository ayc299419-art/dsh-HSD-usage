// Node 入口：API + CLI（dsh-usage）
// 说明：本模块同时是 cordis 插件的"节点半区"（apply 为无害空操作，供 profile 正常加载）。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { InstanceManager } from "./core/InstanceManager.js";
import { Controller } from "./core/Controller.js";
import { LocalUsageSource } from "./core/LocalUsageSource.js";
import { getAdapter, getAllAdapterTypes, registerAdapter } from "./adapters/index.js";
import { TIME_RANGES, RANGE_LABELS } from "./core/types.js";
import { formatUsage, formatNumber } from "./utils/formatters.js";
import { formatFull } from "./utils/time.js";

// ---- cordis 节点半区：注册 loopback 代理路由 ----
// 浏览器直接 fetch 上游（open.bigmodel.cn 等）会被 CORS 拦截，导致智谱/火山拿不到真实用量。
// 参考 dsh-volcengine-usage / dsh-quota-panel 的官方模式：宿主进程注册 loopback 专用路由，
// 浏览器同源调用本路由，由宿主转发到白名单内的上游接口。凭据只在本机回环，不出机器。
export const inject = ["webServer"];

const PROXY_PATH = "/api/dsh-hsd-usage/proxy";
const CONFIG_PATH = "/api/dsh-hsd-usage/config";
const UPSTREAM_ALLOWLIST = [
  "https://open.bigmodel.cn/",
  "https://api.z.ai/",
  "https://open.volcengineapi.com/",
  "https://api.deepseek.com/"
];
const PROXY_TIMEOUT_MS = 15000;

function isLoopbackReq(req) {
  const addr = (req.socket && req.socket.remoteAddress) || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function writeJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(value));
}

function urlAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return UPSTREAM_ALLOWLIST.some((prefix) => (u.origin + "/").startsWith(prefix) || (u.origin + "/") === prefix);
  } catch {
    return false;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// 读取宿主侧配置（$DSH_HOME/dsh-HSD-usage.json）：所有客户端共享同一份，实现跨 origin/跨机同步
function configFilePath() {
  return join(defaultConfigPath());
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: PROXY_PATH,
    handler: async (req, res) => {
      if (!isLoopbackReq(req)) return writeJson(res, 403, { ok: false, error: "forbidden" });
      if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method not allowed" });
      try {
        const body = await readBody(req);
        const url = String(body.url || "");
        const method = String(body.method || "GET").toUpperCase();
        const headers = (body.headers && typeof body.headers === "object") ? body.headers : {};
        if (!urlAllowed(url)) return writeJson(res, 400, { ok: false, error: "upstream not allowlisted: " + url });
        const upstream = await fetch(url, {
          method,
          headers,
          body: method === "GET" || method === "HEAD" ? undefined : String(body.body || ""),
          signal: AbortSignal.timeout(PROXY_TIMEOUT_MS)
        });
        const text = await upstream.text();
        writeJson(res, 200, { ok: true, status: upstream.status, body: text.slice(0, 256 * 1024) });
      } catch (err) {
        const msg = err && err.name === "TimeoutError" ? "upstream timeout (" + PROXY_TIMEOUT_MS + "ms)" : String((err && err.message) || err);
        writeJson(res, 200, { ok: true, status: 0, body: JSON.stringify({ __proxyError: msg }) });
      }
    }
  }), "dsh-hsd-usage: upstream proxy route");

  // 配置读写（同一路径，按方法分发 GET / PUT）—— host 侧权威文件，浏览器经此同步
  const cfgPath = () => configFilePath();
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: CONFIG_PATH,
    handler: async (req, res) => {
      if (!isLoopbackReq(req)) return writeJson(res, 403, { ok: false, error: "forbidden" });
      if (req.method === "GET") {
        try {
          let data = {};
          try { data = JSON.parse(await readFile(cfgPath(), "utf8")); } catch { /* 无文件 → 空 */ }
          writeJson(res, 200, { ok: true, config: data });
        } catch { writeJson(res, 200, { ok: true, config: {} }); }
        return;
      }
      if (req.method === "PUT" || req.method === "POST") {
        try {
          const body = await readBody(req);
          await mkdir(dirname(cfgPath()), { recursive: true });
          await writeFile(cfgPath(), JSON.stringify(body, null, 2), "utf8");
          writeJson(res, 200, { ok: true });
        } catch (err) {
          writeJson(res, 500, { ok: false, error: String((err && err.message) || err) });
        }
        return;
      }
      return writeJson(res, 405, { ok: false, error: "method not allowed" });
    }
  }), "dsh-hsd-usage: config route");
}

// ---- 文件持久化 ----
// 配置文件路径：优先 DSH_USAGE_CONFIG，其次 $DSH_HOME（测试副本隔离的关键），默认 ~/.dsh
export function defaultConfigPath() {
  if (process.env.DSH_USAGE_CONFIG) return process.env.DSH_USAGE_CONFIG;
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "dsh-HSD-usage.json");
}

export function dshHomeDir() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

// ---- 从 DSH settings.yaml 解析 llm-pi-ai.providers（最小 YAML 子集解析器，适用于 dsh 生成的配置形状） ----
export function parseProvidersFromSettings(text) {
  const providers = {};
  let inProviders = false;
  let current = null;
  let inModels = false;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = (line.match(/^ */) || [""])[0].length;
    const trimmed = line.trim();
    if (!inProviders) {
      if (trimmed === "providers:") inProviders = true;
      continue;
    }
    if (indent === 0) { inProviders = false; continue; } // 顶层键 → 块结束
    if (indent === 4 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
      current = trimmed.slice(0, -1).trim();
      providers[current] = { id: current, displayName: current, apiKeyEnv: "", baseURL: "", models: [] };
      inModels = false;
      continue;
    }
    if (current === null) continue;
    if (indent === 6 && trimmed === "models:") { inModels = true; continue; }
    if (inModels && indent === 8 && trimmed.startsWith("- id:")) {
      providers[current].models.push(trimmed.replace("- id:", "").trim());
      continue;
    }
    if (inModels && indent === 6) inModels = false;
    if (indent === 6 && trimmed.startsWith("displayName:")) {
      providers[current].displayName = trimmed.slice("displayName:".length).trim().replace(/^['"]|['"]$/g, "");
    } else if (indent === 6 && trimmed.startsWith("baseURL:")) {
      providers[current].baseURL = trimmed.slice("baseURL:".length).trim().replace(/^['"]|['"]$/g, "");
    } else if (indent === 6 && trimmed.startsWith("apiKeyEnv:")) {
      providers[current].apiKeyEnv = trimmed.slice("apiKeyEnv:".length).trim();
    }
  }
  return providers;
}

// 按 baseURL / 模型名 / 提供方 id 推断服务商类型
export function inferProviderType(provider) {
  const b = (provider.baseURL || "").toLowerCase();
  const models = (provider.models || []).join(" ").toLowerCase();
  const id = (provider.id || "").toLowerCase();
  if (b.includes("volces.com") || b.includes("volcengine") || b.includes("ark.") || id.includes("huoshan")) return "volcano";
  if (b.includes("deepseek")) return "deepseek";
  if (b.includes("bigmodel") || models.includes("glm") || id.includes("zai") || id.includes("bigmodel")) return "zhipu";
  if (models.includes("kimi") || id.includes("kimi")) return "kimi"; // 预留
  return "volcano";
}

export function createFileStorage(filePath) {
  const mem = new Map();
  return {
    filePath,
    async load() {
      try {
        const text = await readFile(filePath, "utf8");
        const data = JSON.parse(text);
        for (const [k, v] of Object.entries(data || {})) mem.set(k, v);
      } catch {
        /* 文件不存在/损坏 → 空 */
      }
    },
    async flush() {
      const data = {};
      for (const [k, v] of mem.entries()) data[k] = v;
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2));
    },
    getJSON(key, fallback = null) {
      if (!mem.has(key)) return fallback;
      const v = mem.get(key);
      if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
      return v;
    },
    setJSON(key, value) {
      mem.set(key, value);
    },
    get(key) { return mem.has(key) ? mem.get(key) : null; },
    set(key, value) { mem.set(key, value); },
    remove(key) { mem.delete(key); }
  };
}

// ---- 组装监控实例（CLI / Node API 共用） ----
export async function createMonitor(options = {}) {
  const filePath = options.configPath || defaultConfigPath();
  const fileStorage = createFileStorage(filePath);
  await fileStorage.load();

  const manager = new InstanceManager({ storage: fileStorage });
  const localSource = options.localSource === false ? null : new LocalUsageSource({ cachePath: options.localCachePath });
  const controller = new Controller({
    manager,
    adapters: getAdapter,
    localSource,
    refreshIntervalMs: options.refreshIntervalMs || 5 * 60 * 1000
  });

  const savedConfig = fileStorage.getJSON("config", null);
  if (savedConfig) controller.updateConfig(savedConfig);

  return { manager, controller, localSource, storage: fileStorage, configPath: filePath };
}

export { getAdapter, getAllAdapterTypes, registerAdapter, TIME_RANGES, RANGE_LABELS, formatUsage, formatNumber, formatFull };

// ---- 报告 ----
export function renderReport(usages, instances) {
  const lines = [];
  for (const inst of instances) {
    const u = usages.get(inst.id);
    lines.push(`[${inst.type}] ${inst.name} (${inst.id})`);
    for (const range of TIME_RANGES) {
      const key = "usage" + (range === "5h" ? "5h" : range === "week" ? "Week" : "Month");
      const d = u && u[key];
      let text;
      if (d && d.available) text = formatUsage(d.value, d.unit) + "（API）";
      else if (d && d.source === "estimate") text = formatUsage(d.value, "tokens") + "（本地估算）";
      else text = "N/A" + (d && d.reason ? " · " + d.reason : "");
      lines.push(`  ${RANGE_LABELS[range].padEnd(4)}: ${text}`);
    }
    lines.push(`  更新于 ${u ? formatFull(u.lastUpdated) : "未更新"}`);
  }
  return lines.join("\n");
}

// ---- CLI ----
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0] || "help";

  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(helpText());
    return 0;
  }

  const monitor = await createMonitor({ configPath: args.config });
  const { manager, controller, storage } = monitor;

  switch (cmd) {
    case "list": {
      const all = manager.getAll();
      if (all.length === 0) {
        console.log("（暂无实例）添加：dsh-usage add --type volcano --name \"Coding Plan\" --set accessKeyId=... --set secretAccessKey=...");
      } else {
        for (const it of all) {
          console.log(`${it.enabled ? "●" : "○"} ${it.id}  quota=${it.quotaLimit ?? "-"}  creds={${Object.keys(it.credentials).join(",")}}`);
        }
      }
      return 0;
    }

    case "add": {
      try {
        const inst = manager.add({
          type: args.type,
          name: args.name,
          credentials: args.credentials,
          quotaLimit: args.quota ? Number(args.quota) : undefined
        });
        await storage.flush();
        console.log("已添加:", inst.id);
      } catch (err) {
        console.error("添加失败:", err.message);
        return 1;
      }
      return 0;
    }

    case "remove": {
      const id = args._[1];
      if (!id) { console.error("用法: dsh-usage remove <instanceId>"); return 1; }
      if (manager.remove(id)) { await storage.flush(); console.log("已删除:", id); }
      else { console.error("未找到实例:", id); return 1; }
      return 0;
    }

    case "toggle": {
      const id = args._[1];
      if (!id) { console.error("用法: dsh-usage toggle <instanceId>"); return 1; }
      const on = manager.toggleEnabled(id);
      await storage.flush();
      console.log(id, on ? "已启用" : "已隐藏");
      return 0;
    }

    case "test": {
      const id = args._[1];
      const inst = id ? manager.getById(id) : manager.getEnabled()[0];
      if (!inst) { console.error("未找到实例"); return 1; }
      const adapter = getAdapter(inst.type);
      if (!adapter) { console.error("适配器未注册:", inst.type); return 1; }
      const ok = await adapter.testConnection(inst.credentials);
      console.log(`${inst.id} → ${ok ? "连接成功" : "连接失败"}`);
      return ok ? 0 : 1;
    }

    case "refresh": {
      const id = args._[1];
      if (id) await controller.refreshInstance(id);
      else await controller.refreshAll();
      console.log(renderReport(controller.getAllCachedUsages(), manager.getEnabled()));
      return 0;
    }

    case "report": {
      await controller.refreshAll();
      console.log(renderReport(controller.getAllCachedUsages(), manager.getEnabled()));
      return 0;
    }

    case "config": {
      const pairs = args._.slice(1);
      if (pairs.length === 0) {
        console.log(JSON.stringify(controller.config, null, 2));
        return 0;
      }
      const patch = {};
      for (const p of pairs) {
        const eq = p.indexOf("=");
        if (eq === -1) { console.error("用法: dsh-usage config refreshIntervalMs=300000 ratioMode=global"); return 1; }
        const k = p.slice(0, eq);
        let v = p.slice(eq + 1);
        if (["refreshIntervalMs"].includes(k)) v = Number(v);
        if (v === "true") v = true;
        if (v === "false") v = false;
        if (v === "null") v = null;
        patch[k] = v;
      }
      controller.updateConfig(patch);
      storage.setJSON("config", controller.config);
      await storage.flush();
      console.log(JSON.stringify(controller.config, null, 2));
      return 0;
    }

    case "import-settings": {
      const settingsPath = args.settings || join(dshHomeDir(), "settings.yaml");
      let text;
      try {
        text = await readFile(settingsPath, "utf8");
      } catch (err) {
        console.error("读取设置失败:", settingsPath, err.message);
        return 1;
      }
      const providers = parseProvidersFromSettings(text);
      const ids = Object.keys(providers);
      if (ids.length === 0) {
        console.log("settings.yaml 中未发现 llm-pi-ai.providers");
        return 0;
      }
      let added = 0, skipped = 0;
      for (const id of ids) {
        const p = providers[id];
        const type = inferProviderType(p);
        const name = (p.displayName || id).trim() || id;
        const instanceId = type + ":" + name;
        if (manager.getById(instanceId)) {
          console.log("· 已存在，跳过:", instanceId);
          skipped += 1;
          continue;
        }
        manager.add({
          type,
          name,
          credentials: {}, // 密钥来自 apiKeyEnv 环境变量，可在 GUI 配置弹窗或 CLI --set 补填
          quotaLimit: undefined
        });
        console.log("+ 已导入:", instanceId, "  baseURL=" + (p.baseURL || "-"), "  模型 " + p.models.length + " 个");
        added += 1;
      }
      await storage.flush();
      console.log("导入完成：新增 " + added + "，跳过 " + skipped);
      return 0;
    }

    default:
      console.error("未知命令:", cmd);
      console.log(helpText());
      return 1;
  }
}

function parseArgs(argv) {
  const args = { _: [], credentials: {}, config: process.env.DSH_USAGE_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const inline = eq === -1 ? null : a.slice(eq + 1);
      const val = inline != null ? inline : argv[i + 1];
      if (inline == null) i += 1;
      if (key === "set") {
        const eq2 = val.indexOf("=");
        if (eq2 !== -1) args.credentials[val.slice(0, eq2)] = val.slice(eq2 + 1);
      } else if (key === "api-key" || key === "apiKey") args.credentials.apiKey = val;
      else if (key === "ak") args.credentials.accessKeyId = val;
      else if (key === "sk") args.credentials.secretAccessKey = val;
      else if (key === "usage-url") args.credentials.usageUrl = val;
      else args[key] = val;
    } else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) {
      // 短选项忽略（保留 _ 解析）
    } else {
      args._.push(a);
    }
  }
  return args;
}

function helpText() {
  return `DeepSeekHarness 用量监控插件 (dsh-usage)

用法:
  dsh-usage list                               列出实例
  dsh-usage add --type <deepseek|zhipu|volcano> --name "<自定义名称>" [--quota 1000000] [--set key=value ...] [--usage-url <url>]
  dsh-usage remove <instanceId>
  dsh-usage toggle <instanceId>
  dsh-usage test <instanceId>                  测试连接
  dsh-usage refresh [instanceId]               刷新并打印用量
  dsh-usage report                             刷新全部并打印报告
  dsh-usage config [key=value ...]             查看/修改全局配置

凭据快捷选项:
  --api-key <key>         deepseek/zhipu 的 API Key
  --ak <id> --sk <key>    火山的 AccessKey/SecretKey
  --set accessKeyId=... --set secretAccessKey=...
  --usage-url <url>       火山用量查询 URL（可选）

全局配置:
  refreshIntervalMs  ratioMode(global|instance)  unitPreference(tokens|requests|cost)  defaultQuotaLimit
`;
}
