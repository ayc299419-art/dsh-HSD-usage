# DeepSeekHarness 用量监控插件 —— 需求文档

> 项目：dsh-HSD-usage（DeepSeekHarness 多服务商 API 用量监控插件）
> 本文档把原始需求逐条整理为可验收的文字描述，并在每条后标注当前实现状态。

---

## 一、总体目标

在 DeepSeekHarness（DSH）的 GUI 里做一个**多服务商 API 用量监控插件**：
在**侧边栏"设置"区域上方**常驻一个组合条形柱组件，直观展示每个已配置服务商实例在
**5 小时 / 本周 / 本月**三个时间维度的用量，并提供完整配置管理。

- 支持服务商：DeepSeek、智谱 GLM（bigmodel）、火山方舟（Volcano Ark）；可扩展 Kimi、OpenCode Go 等
- 同一服务商可添加**多个实例**（多个计划/账号）
- 两种使用形态：**GUI 客户端插件** + **CLI**（dsh-usage）

---

## 二、原始需求逐条整理

### R1 组合条形柱
- 每个实例一根**组合条形柱**：
  - 主柱：**粗、蓝色 #4A90E2**，表示 5 小时用量
  - 细柱：**绿色 #50C878**，表示本周用量
  - 细柱：**橙色 #FF8C42**，表示本月用量
- 状态：已实现（UsageBar.js）

### R2 满格 = 月配额耗尽
- 为实例配置月配额上限（quotaLimit）后，三根柱全部充满即表示该实例月配额耗尽
- 未配置 quotaLimit 时，满格以"所有启用实例的最大月用量"为参考基准
- 状态：已实现（UsagePanel.baselineFor，global 模式含 quotaLimit 参与 max 计算）

### R3 柱长比例基准
- 默认**全局统一基准**：所有启用实例的月用量最大值（含配额上限）作为 100% 满格
- 可切换为**单实例内部基准**：每个实例用自己的最大值做满格
- 状态：已实现（ratioMode = global / instance）

### R4 数值显示
- 柱内显示数值 + 单位（如 "1.2M tokens / 5 小时"）；5h 主柱数值更突出
- 单位偏好可配置：tokens / requests / cost
- 状态：已实现

### R5 数据不可用的展示
- 某个维度取不到真实数据时：**灰色柱 + N/A**
- tooltip 里说明原因；不报错、不白屏
- API 不可用时自动回退**本地会话记录估算**（读 DSH 的 session_projcache.json 聚合 token，标注"估算"）
- 状态：已实现（端点与解析对齐 dsh-quota-panel / dsh-volcengine-usage，签名与参考实现逐字节一致）

### R5.1 端点预置（零手工 URL 配置）
- **火山方舟**：端点/签名/解析全部内置 —— POST open.volcengineapi.com（Action/Region/Version 预置），
  火山变体 HMAC-SHA256 签名（固定 SignedHeaders 顺序、裸算法名、/request scope、原始字节密钥链），
  两步 fallback：GetAFPUsage（Agent Plan，Quota/Used）→ GetCodingPlanUsage（Coding Plan，QuotaUsage 百分比）
  —— **用户只需填 AK/SK，不需要任何 URL**
- **智谱 GLM / Coding 计划**：官方用量监控接口 GET open.bigmodel.cn/api/monitor/usage/quota/limit
  （Bearer API Key）—— TOKENS_LIMIT unit=3 → 5h、unit=6 → 周、TIME_LIMIT → 月；
  非 Coding 计划回退 limits[{remaining,number}] 余量 —— **用户只需填 API Key**
- 百分比数据渲染：柱状图直接按官方返回的百分比填充（unit="%"，满格=100%）
- 状态：已实现；签名与 dsh-quota-panel 参考实现逐字节一致（自动化测试覆盖），解析器测试覆盖

### R6 悬停提示（tooltip）
- 悬停实例柱时显示：实例名称、各维度用量类型与数值单位、**刷新时间（格式"更新于 HH:MM"）**
- 状态：已实现

### R7 多实例（同一服务商多个计划）
- 同一服务商类型可添加多个实例
- 实例唯一 ID 规则 = "服务商类型:自定义名称"，重名冲突要检测并提示
- 状态：已实现（InstanceManager.add 冲突检测）

### R8 实例显隐控制（本次改版核心）
- 用**勾选框**选择**显示哪个实例、不显示哪个实例**（勾选 = 在侧边栏面板显示）
- 提供**全部显示 / 全部隐藏 / 反选**快捷按钮
- 被隐藏的实例**不参与数据刷新**
- 显隐状态持久化
- 状态：已实现（SettingsSection.js / DomSettingsCard.js；manager.setEnabled / showAll / hideAll / invert）

### R9 实时刷新
- 定时自动刷新（默认 5 分钟，间隔可配置）
- 手动刷新：全局刷新 + 单实例刷新
- **模型切换自动刷新**：检测 DSH 里的模型切换，自动映射到对应服务商实例并刷新
- 状态：已实现（Controller 定时器 + mount.js MutationObserver 模型名监听）

### R10 配置管理全部放进 DSH 设置页（本次改版核心）
- 原方案（插件自己的弹窗）**废弃**：黑不溜秋看不清，且不在设置页里
- 新要求：**所有配置选项都放到 DSH 的"设置"页面里**，包括：
  - 显示哪个实例 / 隐藏哪个实例（**对勾选项方式**）
  - 实例增删改（服务商类型、名称、凭据、月配额）
  - 全局设置（刷新间隔、柱长比例基准、单位偏好、默认配额）
- 侧边栏面板只保留**只读展示**（条形柱 + tooltip + 刷新按钮），不再是配置入口
- 配置随 DSH 主题自适应（使用真实主题变量 --dsw-alias-*），不再发黑
- **设置相关内容必须以"独立标签"（设置抽屉左侧导航项）形式存在**，不是塞进别的标签页里
- 状态：已实现，双通道保障：
  - 通道一（主）：官方 settings.section 插槽注册 —— 设置抽屉导航项「用量监控」，
    参照 dsh-quota-panel 的官方插槽模式（slots.inject + slots.register），
    并以轮询 ctx.get("slots") 等服务就绪，规避纤维 PENDING 竞态
  - 通道二（兜底）：DOM 注入完整配置卡片进设置抽屉内容区（DomSettingsCard.js，纯 DOM 零依赖）；
    插槽一旦注册成功即自动移除兜底卡片，避免重复

### R11 黑屏问题修复
- 根因：原配置弹窗用了主题里**不存在的 CSS 变量**（--dsw-alias-surface-l2），退到深色兜底背景，
  而文字用了真实变量（浅色主题下是深色），形成**深底深字 = 看不见**
- 修复：全部样式改用真实 DSH 主题变量（--dsw-alias-bg-layer-*、--dsw-alias-label-*、
  --dsw-alias-border-*、--dsw-alias-button-*、--dsw-alias-brand-primary 等）+ 合理兜底值
- 状态：已修复（styles.js）

### R12 隔离测试副本 = 完全克隆生产插件环境（用于冲突测试）
- 需要**专门用于测试插件稳定性的 DSH 副本**，不污染生产实例（~/.dsh + 3080）
- **副本必须完全复制原版的插件环境**：除测插件可用性外，还要测**与生产其他插件是否互相冲突**
- 具体克隆内容：整个 web profile（全部已装插件 + node_modules + cordis.patch.yml 名册）、
  settings.yaml、.credentials.yaml，再叠加被测插件
- 用 DSH_HOME 环境变量指向独立数据根目录，一键脚本启动（默认端口 3090）
- 插件自身尊重 DSH_HOME（配置文件、本地用量缓存都隔离）
- 验收：生产全部 client 类插件 + 被测插件同时出现在 boot manifest；启动无错误；
  端口/资源冲突时各插件优雅降级（实测 dsh-hsd-mobile 换端口、dsh-passwords 跳过拉起）
- 状态：已实现（scripts/test-copy.sh 克隆模式，--fresh 保留旧的最小 profile 行为）

### R13 CLI
- 不依赖 GUI 的命令行工具 dsh-usage：add / list / toggle / test / report / config / import-settings
- import-settings 可从 DSH 的 settings.yaml 自动导入提供方为插件实例（按 baseURL/模型名推断类型）
- 命令尊重 DSH_HOME / DSH_USAGE_CONFIG / DSH_USAGE_LOCAL_CACHE
- 状态：已实现（bin/dsh-usage.mjs）

### R14 参考资料（官方/社区成熟插件）
- https://github.com/helloworld1631/dsh-volcengine-usage —— 火山 Coding Plan 用量悬浮卡
  （固定定位可拖拽小方块、纯 DOM + React root、host API 代理凭据、inject 为空）
- https://github.com/wenzetan/dsh-quota-panel —— 额度胶囊 + 展开卡片 + 面板内设置
  （shell.overlay 官方插槽、slots.inject/register 模式、dsh.client.inject 声明 bundle 依赖、
  immediately 预取、Harness 设计令牌 --dsw-alias-*）
- 两仓库已下载到 ~/Desktop/harness/ 供离线参考；本插件的插槽注册、bundle 依赖声明、
  主题变量用法均与之对齐
- 状态：已吸收（package.json dsh.client.inject/immediately、settings.section 注册模式、主题变量）

### R15 最终交互形态（汇总）
- **设置上方固定一个小方块**：组合条形柱（R1-R6），常驻侧边栏设置区域上方
- **设置页内独立标签**：全部配置项（R8 显隐勾选、实例增删改、全局设置）集中在
  设置抽屉「用量监控」标签下，不与设置页其他内容混杂
- 状态：已实现

---

## 三、非功能需求

- **离线可用**：打包为单文件 client.js（零运行时外部依赖，react 等平台 seed 词运行时回落解析）
- **健壮性**：任何 API/签名/接口失败都优雅回退（本地估算或 N/A），不让插件或宿主报错
- **适配器可扩展**：新增服务商 = 新建一个 Adapter 类 + 注册 + ADAPTER_META 补表单字段
- **持久化**：GUI 配置存浏览器 localStorage（按来源隔离）；CLI 配置存 $DSH_HOME/dsh-HSD-usage.json
- **冒烟测试**：核心逻辑 + CLI + bundle 加载 + 设置区块注册 + DOM 卡片渲染全覆盖

---

## 四、验收清单

- 已实现：侧边栏设置区上方渲染组合条形柱（粗柱 5h 蓝、细柱周/月 绿/橙），颜色与需求一致
- 已实现：满格 = 月配额耗尽（配置 quotaLimit 后）
- 已实现：同一服务商多实例，唯一 ID = "type:name"，重名冲突检测
- 已实现：悬停显示"更新于 HH:MM"
- 已实现：勾选框控制实例显隐（全部显示/全部隐藏/反选），隐藏实例不刷新，状态持久化
- 已实现：模型切换后自动映射刷新对应实例
- 已实现：所有配置在 DSH 设置页内（插槽 + DOM 兜底双通道），随主题自适应
- 已实现：数据不可用时 N/A / 估算，不报错
- 已实现：隔离测试副本一键启动，与生产完全隔离
- 限制：真实用量数值取决于服务商是否提供按时间分桶接口（DeepSeek 官方无此接口，只能本地估算）
