// 适配器注册表
import { DeepSeekAdapter } from "./DeepSeekAdapter.js";
import { ZhipuAdapter } from "./ZhipuAdapter.js";
import { VolcanoAdapter } from "./VolcanoAdapter.js";

const adapters = new Map();

export function registerAdapter(adapter) {
  if (!adapter || !adapter.type) throw new Error("适配器缺少 type");
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type) {
  return adapters.get(type);
}

export function getAllAdapterTypes() {
  return [...adapters.keys()];
}

export function getAllAdapters() {
  return [...adapters.values()];
}

// 注册内置适配器
registerAdapter(new DeepSeekAdapter());
registerAdapter(new ZhipuAdapter());
registerAdapter(new VolcanoAdapter());

// 类型展示名与凭据字段说明（供配置界面动态生成表单）
// 端点全部预置：火山（open.volcengineapi.com 两步用量查询）、智谱（官方用量监控接口），无需手工填 URL
export const ADAPTER_META = {
  deepseek: { label: "DeepSeek", fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }] },
  zhipu: { label: "智谱 GLM / Coding 计划", fields: [{ key: "apiKey", label: "API Key", type: "password", required: true }] },
  volcano: {
    label: "火山方舟（Agent/Coding Plan）",
    fields: [
      { key: "accessKeyId", label: "Access Key ID", type: "text", required: true },
      { key: "secretAccessKey", label: "Secret Access Key", type: "password", required: true },
      { key: "plan", label: "查询的套餐（两套都订阅就各建一个实例）", type: "select", required: false,
        options: [
          { value: "agent", label: "Agent Plan" },
          { value: "coding", label: "Coding Plan" },
          { value: "auto", label: "自动（先 Agent，查不到再 Coding）" }
        ] },
      { key: "region", label: "Region（默认 cn-beijing，可不填）", type: "text", required: false }
    ]
  }
};
