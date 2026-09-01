// 持久化（跨客户端同步版）：
//   - 权威数据在宿主侧 $DSH_HOME/dsh-HSD-usage.json（经 /api/dsh-hsd-usage/config 读写）
//   - 浏览器用 localStorage 作为本地快缓存（UI 同步无感），每次写同步推送到宿主；
//     启动时 hydrate() 从宿主拉取合并 → 所有客户端（本地/远程/任何 origin）看到同一份
//   - Node / 无 localStorage 时退化为内存 Map
const PREFIX = "dsh-HSD-usage:";
const SYNC_KEYS = ["instances", "config"];
const CONFIG_URL = "/api/dsh-hsd-usage/config";

export function createStorage(options = {}) {
  const mem = new Map();
  const useLocalStorage = typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined";
  const inBrowser = typeof window !== "undefined";
  const prefix = options.prefix || PREFIX;
  const syncKeys = options.syncKeys || SYNC_KEYS;
  const blob = {}; // 待同步的键值（实例/全局配置）

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
    if (useLocalStorage) globalThis.localStorage.setItem(k, value);
    else mem.set(k, value);
    if (syncKeys.includes(key)) {
      try { blob[key] = JSON.parse(value); } catch { /* 保留旧值 */ }
    }
  }
  function remove(key) {
    const k = prefix + key;
    if (useLocalStorage) globalThis.localStorage.removeItem(k);
    else mem.delete(k);
  }
  function getJSON(key, fallback = null) {
    const raw = get(key);
    if (raw == null || raw === "") return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  function setJSON(key, value) {
    const json = JSON.stringify(value);
    set(key, json);
    if (syncKeys.includes(key)) schedulePush();
  }
  // 写推送：合并当前所有同步键，PUT 到宿主（尽力而为，失败忽略——localStorage 兜底）
  let pushTimer = null;
  function schedulePush() {
    if (!inBrowser) return;
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const payload = {};
      for (const k of syncKeys) {
        const raw = get(k);
        if (raw != null) { try { payload[k] = JSON.parse(raw); } catch { payload[k] = raw; } }
      }
      try {
        fetch(CONFIG_URL, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch { /* 忽略 */ }
    }, 150);
  }
  // 启动时从宿主拉取并合并（宿主有数据则以宿主为准）
  async function hydrate() {
    if (!inBrowser) return null;
    try {
      const res = await fetch(CONFIG_URL, { method: "GET" });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data || !data.config || typeof data.config !== "object") return null;
      const server = data.config;
      let adopted = null;
      for (const k of syncKeys) {
        if (server[k] !== undefined) {
          const json = JSON.stringify(server[k]);
          set(k, json);
          adopted = adopted || {};
          adopted[k] = server[k];
        }
      }
      return adopted;
    } catch { return null; }
  }
  return { get, set, remove, getJSON, setJSON, hydrate, syncKeys: syncKeys.slice() };
}

// 默认共享单例
export const storage = createStorage();
