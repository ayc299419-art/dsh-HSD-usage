// 极简事件总线（浏览器 / Node 通用）
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(event, handler) {
    let list = this.handlers.get(event);
    if (!list) {
      list = new Set();
      this.handlers.set(event, list);
    }
    list.add(handler);
    return () => this.off(event, handler);
  }
  off(event, handler) {
    const list = this.handlers.get(event);
    if (list) list.delete(handler);
  }
  emit(event, ...args) {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of [...list]) {
      try {
        handler(...args);
      } catch (err) {
        console.error("[dsh-HSD-usage] event handler error:", err);
      }
    }
  }
  once(event, handler) {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
  }
}

export const eventBus = new EventBus();
