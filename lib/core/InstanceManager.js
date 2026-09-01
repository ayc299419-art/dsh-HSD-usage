// 实例管理器：多服务商实例的增删改查、冲突检测、启用/隐藏、持久化。
// 依赖注入 storage 与 eventBus，便于浏览器（localStorage）与 Node（文件）复用。
import { instanceId, isValidInstanceName } from "./types.js";
import { eventBus } from "./eventBus.js";
import { createStorage } from "./storage.js";

const KEY = "instances";

function normalizeCredentialInput(credentials) {
  const out = {};
  if (!credentials) return out;
  for (const [k, v] of Object.entries(credentials)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

export class InstanceManager {
  constructor(options = {}) {
    this.storage = options.storage || createStorage();
    this.instances = [];
    this.load();
  }

  load() {
    const saved = this.storage.getJSON(KEY, null);
    this.instances = Array.isArray(saved) ? saved : [];
    // 兜底：老数据补齐字段（order 缺失时按现有顺序补）
    this.instances = this.instances.map((it, idx) => ({
      enabled: true,
      quotaLimit: undefined,
      order: idx,
      ...it,
      order: Number.isInteger(it.order) ? it.order : idx
    }));
  }

  persist() {
    this.storage.setJSON(KEY, this.instances);
    eventBus.emit("instances-changed", this.instances);
  }

  // 统一按 order 排序（order 相同按创建时间兜底）
  sorted(list) {
    return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
  }

  getAll() {
    return this.sorted(this.instances);
  }

  getEnabled() {
    return this.sorted(this.instances.filter((i) => i.enabled));
  }

  getById(id) {
    return this.instances.find((i) => i.id === id);
  }

  add(input) {
    const name = (input.name || "").trim();
    if (!isValidInstanceName(name)) throw new Error("自定义名称不能为空");
    const type = (input.type || "").trim();
    if (!type) throw new Error("服务商类型不能为空");
    const id = instanceId(type, name);
    if (this.getById(id)) {
      throw new Error(`实例名称冲突："${name}" 已存在同一服务商下，请使用不同的自定义名称`);
    }
    const instance = {
      id,
      type,
      name,
      credentials: normalizeCredentialInput(input.credentials),
      quotaLimit: typeof input.quotaLimit === "number" && input.quotaLimit > 0 ? input.quotaLimit : undefined,
      enabled: input.enabled !== false,
      order: this.instances.reduce((m, i) => Math.max(m, (Number.isInteger(i.order) ? i.order : 0) + 1), 0),
      createdAt: Date.now()
    };
    this.instances.push(instance);
    this.persist();
    return instance;
  }

  update(id, updates) {
    const idx = this.instances.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    const next = { ...this.instances[idx], ...updates };
    if (updates.name !== undefined) {
      const name = (updates.name || "").trim();
      if (!isValidInstanceName(name)) throw new Error("自定义名称不能为空");
      const newId = instanceId(next.type, name);
      if (newId !== id && this.getById(newId)) {
        throw new Error(`实例名称冲突："${name}" 已存在`);
      }
      next.id = newId;
      next.name = name;
    }
    if (updates.credentials !== undefined) next.credentials = normalizeCredentialInput(updates.credentials);
    if (updates.quotaLimit !== undefined) {
      next.quotaLimit = typeof updates.quotaLimit === "number" && updates.quotaLimit > 0 ? updates.quotaLimit : undefined;
    }
    this.instances[idx] = next;
    this.persist();
    return true;
  }

  remove(id) {
    const before = this.instances.length;
    this.instances = this.instances.filter((i) => i.id !== id);
    if (this.instances.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  setEnabled(id, enabled) {
    const inst = this.getById(id);
    if (inst) {
      inst.enabled = !!enabled;
      this.persist();
    }
  }

  toggleEnabled(id) {
    const inst = this.getById(id);
    if (inst) {
      this.setEnabled(id, !inst.enabled);
      return inst.enabled;
    }
    return false;
  }

  // 拖动排序：按给定 id 顺序重排（缺失的 id 保持在末尾，原有相对顺序不变）
  reorder(orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) return false;
    const rank = new Map();
    orderedIds.forEach((id, idx) => rank.set(id, idx));
    const rest = this.instances
      .filter((i) => !rank.has(i.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let next = orderedIds.length;
    for (const inst of rest) rank.set(inst.id, next++);
    for (const inst of this.instances) inst.order = rank.get(inst.id) ?? inst.order ?? 0;
    this.persist();
    return true;
  }

  // 批量工具（工具栏）
  showAll() {
    for (const it of this.instances) it.enabled = true;
    this.persist();
  }
  hideAll() {
    for (const it of this.instances) it.enabled = false;
    this.persist();
  }
  invert() {
    for (const it of this.instances) it.enabled = !it.enabled;
    this.persist();
  }
}
