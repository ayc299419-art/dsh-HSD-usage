// 设置页区块：在 DSH「设置」抽屉（sidebar.settings → settings.section 插槽）里渲染用量监控的
// 全部配置 —— 实例显隐勾选、增删改、全局设置。用 React.createElement（无 JSX），
// 依赖 react 平台 seed 词（由 DSH client-modules 解析）。
//
// !! 铁律：所有 hooks 必须无条件下、在任何 early return 之前调用。
// 曾经把 useState 放在 "if (!ready) return" 之后 —— ready 翻转后第二次渲染的 hooks
// 数量比第一次多，React 抛 "Rendered more hooks than during the previous render"，
// 直接把整个设置抽屉的 React 树卸载成整页空白。
import * as React from "react";
import { getApp } from "./mount.js";
import { eventBus } from "../core/eventBus.js";
import { storage } from "../core/storage.js";
import { ADAPTER_META, getAllAdapterTypes } from "../adapters/index.js";
import { isValidInstanceName } from "../core/types.js";

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
export function SettingsSection() {
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
export function registerSettingsSection(ctx) {
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
