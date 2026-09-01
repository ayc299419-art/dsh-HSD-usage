// GUI 挂载：把用量面板挂到侧边栏"设置区域上方"，并监听模型切换。
// 挂载策略：
//  1) 注入样式
//  2) 找到设置区域锚点（settingsArea/footArea/sidebar）
//  3) 在锚点之前插入面板
//  4) 找不到时用 MutationObserver 重试（GUI 客户端渲染）
//  5) 模型切换：监听模型名元素文本变化，变化即触发映射实例刷新
import { injectStyle } from "./dom.js";
import { CSS } from "./styles.js";
import { UsagePanel } from "./UsagePanel.js";
import { InstanceManager } from "../core/InstanceManager.js";
import { Controller } from "../core/Controller.js";
import { storage } from "../core/storage.js";
import { eventBus } from "../core/eventBus.js";
import { getAdapter, getAllAdapterTypes } from "../adapters/index.js";
import { buildSettingsCard, destroySettingsCard } from "./DomSettingsCard.js";

let mounted = false;
let app = null;

export function createApp(options = {}) {
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

export function getApp() {
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

export function mountPanel(options = {}) {
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
