# dsh-HSD-usage（涵盛达API用量查询）

DeepSeekHarness 多服务商 API 用量监控插件。在 **侧边栏设置区域上方** 常驻显示组合条形柱，
直观展示每个已配置服务商实例（可多个，同一服务商可添加多个计划）在 **5 小时 / 周 / 月** 三个时间维度的用量。
所有配置（实例显隐勾选、拖动排序、增删改、全局设置）都在 **DSH 设置抽屉 → HSD 用量监控** 区块。

- 支持服务商：**DeepSeek**、**智谱 GLM / Coding 计划 (bigmodel)**、**火山方舟 (Volcano Ark)**
- 可扩展：**Kimi (Moonshot)**、**OpenCode Go** 等（见"扩展"）
- 两种使用形态：**GUI 客户端插件**（挂到 DeepSeekHarness 设置区上方）+ **CLI**（dsh-usage）

---

## 1. 功能一览

| 需求 | 实现 |
| --- | --- |
| 组合条形柱 | 主柱（粗、蓝 `#4A90E2`）= 5h 用量；细柱（绿 `#50C878`）= 本周；细柱（橙 `#FF8C42`）= 本月 |
| 满格 = 月配额耗尽 | 配置月配额上限（quotaLimit）后，三柱充满即表示配额耗尽；未配置则满格参考所有实例的最大月用量 |
| 柱长比例 | 全局统一基准（所有启用实例月用量最大值，可切"单实例内部基准"） |
| 数值显示 | 柱内显示数值+单位（如 `1.2M tokens · 5 小时`），5h 数值更突出 |
| 数据不可用 | 灰色柱 + `N/A`，tooltip 显示原因 |
| 悬停提示 | 实例名称、用量类型、数值单位、**刷新时间（更新于 HH:MM）** |
| 显隐控制 | 在 **设置 → 用量监控** 中用**勾选框**选择显示哪些实例；支持"全部显示 / 全部隐藏 / 反选"；隐藏实例不参与刷新 |
| 实时刷新 | 定时（默认 5 分钟，可配）+ 手动全局/单实例刷新 + **模型切换自动刷新**（自动映射服务商） |
| 多实例 | 同一服务商多个实例，唯一 ID = `服务商类型:自定义名称`，冲突检测 |
| 配置管理 | 全部配置（实例显隐勾选、增删改、凭据、月配额、刷新间隔、比例基准、单位偏好）都在 **DSH 设置 → 用量监控** 区块，随主题自适应不再发黑 |

## 2. 安装到 DeepSeekHarness GUI

插件通过 DSH 的客户端插件机制加载（包声明 `dsh.client`，宿主把 `/plugins/dsh-HSD-usage/client.js`
纳入 `window.__DSH_BOOT__` 清单）。三步接入：

```bash
# ① 把本目录加为 web profile 依赖（file: 本地路径，离线）
#    编辑 ~/.dsh/profiles/web/package.json 的 dependencies 增加：
#    "dsh-HSD-usage": "file:/Users/hanchengda/Desktop/harness/dsh-HSD-usage"

# ② 在浏览器插件名册（cordis.patch.yml）中登记一行：
#    - id: usage-monitor
#      name: 'dsh-HSD-usage'

# ③ 安装并重启（GUI 会自动重连）
cd ~/.dsh/profiles/web && pnpm install
# 重启 DeepSeekHarness（GUI 顶部或命令行 dsh web --port 3080）
```

> 若修改源码，重新生成 bundle：`node scripts/build-client.mjs`。
> 卸载：删掉 ①② 的改动并重启即可。

## 3. 隔离测试副本（推荐：不改动生产实例）

> **标准测试实例：端口 3090**。开发/测试任何插件都在此副本先行验证（插件可用性 + 与生产
> 其他插件是否冲突），确认无误再导入生产 3080，避免插件冲突把正式 Harness 搞崩。

想安全测试插件稳定性而不影响正在运行的 DeepSeekHarness（`~/.dsh` + 端口 3080）？
DSH 支持用 **`DSH_HOME` 环境变量**指向一个完全独立的数据根目录（设置/存储/会话/进程全隔离）。

**默认 = 完全克隆生产插件环境**：整个 web profile（全部已装插件 + node_modules + 名册）、
settings.yaml、.credentials.yaml 一并复制，再叠加被测插件——既能测插件可用性，
也能测**与生产其他插件是否互相冲突**。

```bash
# 克隆生产环境 + 被测插件，端口 3090（默认标准；DSH_TEST_HOME 可覆盖测试 home 位置）
DSH_TEST_HOME=/path/to/test-home bash scripts/test-copy.sh

bash scripts/test-copy.sh --reset            # 删除并重建（重新克隆）
bash scripts/test-copy.sh --stop             # 停止测试实例
bash scripts/test-copy.sh --port 3095        # 换端口
bash scripts/test-copy.sh --plugin <dir>     # 测试别的插件目录
bash scripts/test-copy.sh --no-credentials   # 克隆时不带 .credentials.yaml
bash scripts/test-copy.sh --fresh            # 不克隆，用全新最小 profile（旧行为）
```

脚本流程：克隆 `~/.dsh/profiles/web`（含全部插件与 node_modules，APFS clonecopy 秒级）→
复制 settings.yaml / .credentials.yaml → 软链安装被测插件（完全离线，不动克隆环境）→
名册追加被测插件 → 独立端口启动 → **逐个核对生产 client 类插件 + 被测插件都在 boot manifest**。

实测（生产 6 个 client 插件 + 本插件 = 49 个客户端插件同时在线）：
- `dsh-hsd-mobile` 检测到代理端口被生产实例占用 → 优雅改用备用端口
- `dsh-passwords` 检测到密码门已在运行 → 跳过自动拉起
- 无启动错误、无崩溃 —— 插件间按端口/资源优雅降级，冲突可观测

> 密钥说明：settings.yaml 只存 `apiKeyEnv` 环境变量名；.credentials.yaml 是宿主凭据存储，
> 默认一并克隆以获得与生产一致的可调用环境（`--no-credentials` 跳过）。
> 插件自身尊重 `DSH_HOME`：配置文件落在 `$DSH_HOME/dsh-HSD-usage.json`，本地用量
> 缓存读 `$DSH_HOME/storages/session_projcache.json`，与生产完全隔离。

> 密钥说明：settings.yaml 只存 `apiKeyEnv` 环境变量名、不含密钥。测试实例默认无密钥环境，
> 模型列表/面板可用但真实调用需在启动测试实例的 shell 里 export 同样的 `*_API_KEY`。
> 插件本身尊重 `DSH_HOME`：配置文件落在 `$DSH_HOME/dsh-HSD-usage.json`，本地用量
> 缓存读 `$DSH_HOME/storages/session_projcache.json`，与生产完全隔离。

> 要点：`DSH_HOME` 优先级为 显式配置 > `$DSH_HOME` > 默认 `~/.dsh`；测试实例与生产实例
> 端口/数据/进程完全独立，互不干扰。卸载测试副本 = 删掉测试 home 目录。

## 4. CLI 用法（不依赖 GUI）

> 命令自动尊重 `DSH_HOME`（测试副本隔离）与 `DSH_USAGE_CONFIG` / `DSH_USAGE_LOCAL_CACHE` 覆盖。

```bash
# 从当前 DSH 的 settings.yaml 自动导入提供方为插件实例（按 baseURL/模型名推断服务商类型）
node bin/dsh-usage.mjs import-settings            # 用 $DSH_HOME/settings.yaml（或 ~/.dsh）
node bin/dsh-usage.mjs import-settings --settings /path/settings.yaml
```

```bash
# 查看帮助
node bin/dsh-usage.mjs help

# 添加实例（配置默认存 ~/.dsh/dsh-HSD-usage.json，可用 DSH_USAGE_CONFIG 覆盖）
node bin/dsh-usage.mjs add --type deepseek --name "DeepSeek 主账号" --api-key sk-xxx
node bin/dsh-usage.mjs add --type volcano --name "火山-Coding Plan" \
     --set accessKeyId=AKLT... --set secretAccessKey=... --usage-url "https://open.volcengineapi.com/?Action=..." --quota 5000000
node bin/dsh-usage.mjs add --type zhipu --name "智谱 GLM" --api-key xxx

node bin/dsh-usage.mjs list            # 列出实例
node bin/dsh-usage.mjs toggle <id>     # 显示/隐藏
node bin/dsh-usage.mjs test <id>       # 测试连接
node bin/dsh-usage.mjs report          # 刷新全部并打印 5h/周/月 报告
node bin/dsh-usage.mjs config ratioMode=instance refreshIntervalMs=120000
```

## 5. 数据来源与适配器说明

| 服务商 | 接口 | 说明 |
| --- | --- | --- |
| DeepSeek | `GET api.deepseek.com/user/balance`（真实） | 官方只有余额、**没有按时间分桶的用量接口**；5h/周/月 由本地记录估算 |
| 智谱 GLM | `POST open.bigmodel.cn/api/paas/v4/balance`（真实） | `used_total` 为账户累计用量，映射到"月"；5h/周 由本地估算 |
| 火山方舟 | 火山引擎 OpenAPI（AK/SK HMAC-SHA256 签名） | 用量 Action/路径随账号不同；**请在实例凭据中配置 `usageUrl`**，否则自动回退本地估算 |

**本地记录估算**：读取 DeepSeekHarness 的 `~/.dsh/storages/session_projcache.json`
（每个会话的 `tokenUsage`），按会话创建时间落在 5h/周/月窗口内聚合 token 总量，
作为 API 不可用时的兜底（tooltip/报告标注"估算"）。CLI 与 GUI 共用同一套逻辑。

**火山签名**：实现了火山引擎标准签名流程（`X-Date`/`X-Content-Sha256`/`Authorization`，HMAC-SHA256 派生链）。
由于无法在离线环境核对具体用量 Action，签名细节与用量接口路径请在火山控制台确认后以 `usageUrl` 校准；
签名或接口失败会优雅回退，不会让插件报错。

## 6. 架构

```
dsh-HSD-usage/
├── lib/
│   ├── index.js            # Node 入口：API + CLI（也是 cordis 节点半区，apply 为空）
│   ├── client.js           # 生成的 DSH client bundle（id: dsh-HSD-usage）
│   ├── core/
│   │   ├── types.js        # 类型常量、时间窗口、实例 ID 规则
│   │   ├── InstanceManager.js
│   │   ├── Controller.js   # 数据聚合、调度、缓存、模型切换
│   │   ├── eventBus.js
│   │   ├── storage.js      # localStorage / 内存持久化
│   │   └── LocalUsageSource.js   # 本地会话记录估算（Node 侧）
│   ├── adapters/           # BaseAdapter + DeepSeek/Zhipu/Volcano + 注册表
│   ├── utils/              # formatters / time / crypto
│   └── ui/                 # UsagePanel / UsageBar / Toolbar / SettingsSection / DomSettingsCard / mount
├── scripts/
│   ├── build-client.mjs    # 把 lib/**/*.js 打包为单个 client.js（零依赖内联）
│   └── smoke-test.mjs      # 冒烟测试
├── bin/dsh-usage.mjs       # CLI 入口
└── config.example.json
```

事件流：`Controller.refreshAll → 各适配器 fetchUsage(5h/week/month) → 失败回退 LocalUsageSource →
缓存 Map<instanceId, InstanceUsage> → eventBus 广播 usage-updated → UsagePanel 重渲染`。

> **设置页双通道**：配置区块通过两条独立通道进入 DSH 设置抽屉——① 官方 `settings.section` 插槽注册（导航项「用量监控」，`apply` 里用 `ctx.get("slots")`）；② **DOM 兜底**：若插槽通道不可用，MutationObserver 直接把「用量监控配置」卡片注入设置抽屉内容区（`DomSettingsCard.js`，纯 DOM 零依赖），保证配置必现。插件不声明 `inject` 服务依赖，避免纤维因等待 slots 而 PENDING（apply 永不执行）。

## 7. 验收标准对照

- ✅ 设置上方渲染组合条形柱：粗柱 5h、细柱周/月，颜色与文档一致
- ✅ 同一服务商多实例，自定义名称互不冲突（`type:name` 唯一 ID + 冲突检测）
- ✅ 悬停显示刷新时间（"更新于 HH:MM"）
- ✅ 筛选正常，隐藏实例不参与刷新（`getEnabled()` 过滤）
- ✅ 模型切换后映射实例刷新（自动推断服务商关键字；无法映射则刷新全部）
- ✅ 三柱满格 = 月配额耗尽（配置 quotaLimit 后，满格即 quotaLimit 100%）
- ⚠️ 真实用量取决于服务商是否提供按时间分桶接口；不可用时展示 N/A/估算而非报错

## 8. 扩展新服务商（Kimi / OpenCode Go）

在 `lib/adapters/` 下新建适配器并实现 `UsageProviderAdapter` 接口：

```js
import { BaseAdapter } from "./BaseAdapter.js";
export class KimiAdapter extends BaseAdapter {
  type = "kimi";
  async fetchUsage(credentials, timeRange) { /* 实现 */ }
  async testConnection(credentials) { /* 实现 */ }
}
```

在 `lib/adapters/index.js` 中 `registerAdapter(new KimiAdapter())` 并在 `ADAPTER_META`
补充凭据字段表单，然后 `node scripts/build-client.mjs` 重新生成 bundle 即可。

## 9. 验证

```bash
node scripts/build-client.mjs   # 重新打包
node scripts/smoke-test.mjs     # 冒烟测试（核心逻辑 + CLI + bundle 加载）
node bin/dsh-usage.mjs report   # 真实报告
```
