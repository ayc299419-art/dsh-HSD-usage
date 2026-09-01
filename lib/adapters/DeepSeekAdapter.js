// DeepSeek 适配器
// 官方余额接口（真实可用）：GET https://api.deepseek.com/user/balance
// 注意：DeepSeek 目前没有按时间分桶（5h/周/月）的公开用量接口，
// 因此本适配器返回余额信息（meta.balance）并把数值标记为不可用，
// 由控制器的本地记录估算回退填充 5h/周/月 用量。
import { BaseAdapter } from "./BaseAdapter.js";

export class DeepSeekAdapter extends BaseAdapter {
  type = "deepseek";

  get balanceUrl() {
    return "https://api.deepseek.com/user/balance";
  }

  async fetchBalance(credentials) {
    const apiKey = credentials && credentials.apiKey;
    if (!apiKey) throw new Error("缺少 DeepSeek API Key");
    const data = await this.fetchJson(this.balanceUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });
    const info = this.pick(data, ["balance_infos", "data.balance_infos"]);
    const first = Array.isArray(info) && info.length ? info[0] : null;
    return {
      isAvailable: !!this.pick(data, ["is_available"]),
      totalBalance: first ? this.pick(first, ["total_balance"]) : undefined,
      grantedBalance: first ? this.pick(first, ["granted_balance"]) : undefined,
      toppedUpBalance: first ? this.pick(first, ["topped_up_balance"]) : undefined,
      currency: first ? this.pick(first, ["currency"]) : "CNY"
    };
  }

  async fetchUsage(credentials, timeRange) {
    let balance = null;
    try {
      balance = await this.fetchBalance(credentials);
    } catch (err) {
      return this.unavailable("余额查询失败: " + (err && err.message ? err.message : err));
    }
    return this.unavailable("DeepSeek 未提供按时间分桶的用量接口（仅余额可用）", {
      balance,
      model: "balance-only"
    });
  }

  async testConnection(credentials) {
    try {
      await this.fetchBalance(credentials);
      return true;
    } catch {
      return false;
    }
  }
}
