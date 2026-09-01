// 把 lib/**/*.js（ESM）内联打包成单个 DSH client bundle：
//   lib/client.js —— 注册为 window.__ModuleLoader__ 模块（id: dsh-HSD-usage）
// 零外部依赖：仅做 ESM→CJS 的文本变换 + 模块注册表 require。
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libDir = join(root, "lib");

// 仅排除顶层 lib/index.js（Node 入口）与 lib/client.js（产物）；子目录同名文件照常打包
function isExcluded(prefix, entry) {
  if (entry === "client.js") return true;
  if (entry === "LocalUsageSource.js") return true;
  if (prefix === "" && entry === "index.js") return true;
  return false;
}

async function collectFiles(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      out.push(...(await collectFiles(full, prefix + entry + "/")));
    } else if (entry.endsWith(".js") && !isExcluded(prefix, entry)) {
      out.push(prefix + entry);
    }
  }
  return out;
}

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

// ESM → CJS 变换（仅覆盖本项目使用的语法）
function transformEsm(src) {
  const exported = [];
  let hasDefault = false;
  const lines = src.split("\n").map((line) => {
    let m = line.match(/^import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']\s*;?$/);
    if (m) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      return `const { ${names.join(", ")} } = require(${JSON.stringify(m[2])});`;
    }
    m = line.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']\s*;?$/);
    if (m) return `const ${m[1]} = require(${JSON.stringify(m[2])});`;
    m = line.match(/^import\s+(\w+)\s+from\s+["']([^"']+)["']\s*;?$/);
    if (m) return `const { default: ${m[1]} } = require(${JSON.stringify(m[2])});`;

    m = line.match(/^export\s+(async\s+)?function\s+(\w+)/);
    if (m) { exported.push(m[2]); return line.replace(/^export\s+/, ""); }
    m = line.match(/^export\s+class\s+(\w+)/);
    if (m) { exported.push(m[1]); return line.replace(/^export\s+/, ""); }
    m = line.match(/^export\s+const\s+(\w+)\s*=/);
    if (m) { exported.push(m[1]); return line.replace(/^export\s+/, ""); }
    m = line.match(/^export\s+\{([^}]*)\}\s*;?$/);
    if (m) {
      for (const n of m[1].split(",").map((s) => s.trim()).filter(Boolean)) exported.push(n);
      return "";
    }
    m = line.match(/^export\s+default\s+(.+)\s*;?$/);
    if (m) { hasDefault = true; return `const __default = ${m[1]};`; }
    return line;
  });
  let out = lines.join("\n");
  if (exported.length) out += "\n" + [...new Set(exported)].map((n) => `exports.${n} = ${n};`).join("\n");
  if (hasDefault) out += "\nexports.default = __default;";
  return out;
}

const files = (await collectFiles(libDir)).sort();
const modules = [];
for (const rel of files) {
  const src = await readFile(join(libDir, rel), "utf8");
  const transformed = transformEsm(src);
  modules.push({ key: rel, dir: dirname(rel).replace(/^\.$/, ""), body: transformed });
}

const registryBody = modules
  .map(
    (m) =>
      `  register(${JSON.stringify(m.key)}, ${JSON.stringify(m.dir)}, function(require, module, exports) {\n` +
      m.body
        .split("\n")
        .map((l) => "    " + l)
        .join("\n") +
      "\n  });"
  )
  .join("\n\n");

const client = `// 自动生成：scripts/build-client.mjs 打包 lib/**/*.js 生成。请勿手工编辑。
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
${registryBody}

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
      console.log("[dsh-HSD-usage] factory 执行完成");
      return module.exports;
    }
  });
})();
`;

// 烧录构建指纹：面板自检行可显示，用于确认浏览器实际运行的 bundle 版本（防缓存误判）
const { createHash } = await import("node:crypto");
const buildRev = createHash("sha256").update(client).digest("hex").slice(0, 10);
const clientWithRev = client.replace(
  "console.log(\"[dsh-HSD-usage] factory 执行完成\");",
  "console.log(\"[dsh-HSD-usage] factory 执行完成 rev=" + buildRev + "\");\n      try { if (typeof window !== \"undefined\" && window.__usageMonitor) window.__usageMonitor.buildRev = \"" + buildRev + "\"; } catch {}"
);
await writeFile(join(root, "lib", "client.js"), clientWithRev);
console.log("已生成 lib/client.js（" + modules.length + " 个模块，" + Math.round(clientWithRev.length / 1024) + " KB，rev " + buildRev + "）");
