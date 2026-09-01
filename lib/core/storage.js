// 持久化：浏览器用 localStorage；Node / 无 localStorage 时退化为内存 Map。
// 键统一加前缀 dsh-HSD-usage:
const PREFIX = "dsh-HSD-usage:";

export function createStorage(options = {}) {
  const mem = new Map();
  const useLocalStorage = typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined";
  const prefix = options.prefix || PREFIX;

  function get(key) {
    const k = prefix + key;
    if (useLocalStorage) {
      const raw = globalThis.localStorage.getItem(k);
      return raw == null ? null : raw;
    }
    return mem.has(k) ? mem.get(k) : null;
  }
  function set(key, value) {
    const k = prefix + key;
    if (useLocalStorage) {
      globalThis.localStorage.setItem(k, value);
    } else {
      mem.set(k, value);
    }
  }
  function remove(key) {
    const k = prefix + key;
    if (useLocalStorage) {
      globalThis.localStorage.removeItem(k);
    } else {
      mem.delete(k);
    }
  }
  function getJSON(key, fallback = null) {
    const raw = get(key);
    if (raw == null || raw === "") return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function setJSON(key, value) {
    set(key, JSON.stringify(value));
  }
  return { get, set, remove, getJSON, setJSON };
}

// 默认共享单例
export const storage = createStorage();
