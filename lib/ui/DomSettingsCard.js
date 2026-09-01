// 设置抽屉内嵌配置卡片（纯 DOM，零 React / 零 slots 依赖）。
// 用途：即使 Cordis 的 apply/slots 注册链路在真实浏览器里不可用，也能把全部配置
// （实例显隐勾选、增删改、全局设置）直接注入 DSH 设置抽屉的内容区，保证用户可见。
// 数据源 = mount.js 挂载的 app（manager/controller），与面板同源。
import { h, clear } from "./dom.js";
import { eventBus } from "../core/eventBus.js";
import { getAllAdapterTypes, ADAPTER_META } from "../adapters/index.js";
import { instanceId, isValidInstanceName } from "../core/types.js";
import { storage } from "../core/storage.js";

const CARD_CLASS = "dum-sec-card";
const MARKER = "dum-settings-card";

// 渲染整个卡片；返回根元素。manager/controller 来自 app。
export function buildSettingsCard(app) {
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
export function destroySettingsCard(root) {
  if (root && root._dumDisposers) {
    for (const off of root._dumDisposers) off();
    root._dumDisposers = [];
  }
}
