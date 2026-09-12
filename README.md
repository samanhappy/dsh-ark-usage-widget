# dsh-ark-usage-widget

在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）Web 界面左侧边栏底部，固定显示火山方舟 Coding/Agent Plan 的用量。这是一个**可安装的组合包（bundle）**，按官方[打包与安装插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)文档的方式开发与安装。

- **宽侧边栏**：整行显示火山图标 + `66.10% · 49.30% · 24.70%`（近 5 小时 / 近一周 / 近一月，两位小数），位置在「设置」操作栏**下方**
- **窄 rail（折叠态）**：只显示火山图标
- **图标**：内联 SVG 线条火山，颜色跟随 `currentColor`（宽栏 16px / rail 18px），与 DSH 自带图标同规格，随主题与 hover 变色，并与右侧数字视觉中线对齐
- **悬浮**：提示各周期下次重置时间（24h 内显示 `HH:mm`，超过则显示 `M/D`）
- **点击**：弹出详情浮层 —— 三个周期的进度条、剩余额度、重置倒计时，以及手动刷新
- **水位着色**：百分比数字的颜色按「用量 vs 周期时间进度」编码使用水位，不新增任何元素 —— 绿=充足（用量落后于时间节奏）、黄=超额使用（用量领先于时间）、红=明显超额（领先 15pt 以上）或快用尽（用量 ≥90% 无论如何标红）；无周期时间数据时回退为按绝对用量着色
- 样式跟随 DSH 主题（深/浅色），使用官方的 elevation / alias token

> 这是一个 **DSH 内部插件**，只能在同样运行 DSH 的环境里使用；它不是独立程序。

## 包结构

```
dsh-ark-usage-widget/
├── package.json       # 包声明（dsh.bundle + dsh.client）
├── cordis.patch.yml   # 安装时注入的插件配置（一行双面：host 行 + client 行）
├── index.js           # HOST 半：注册 /ark-usage 路由，读 arkcli 用量
├── src/client.js      # CLIENT 半源码（浏览器插件；唯一需要编辑的 UI 文件）
├── build.mjs          # 把 src/client.js 打成 lib/client.js（node build.mjs）
└── lib/client.js      # 构建产物，随包分发（client-modules 运行时按此文件组成 __DSH_BOOT__）
```

## 前置条件

1. 已安装 DSH（`dsh` CLI 在 PATH 上），使用 `web`（或任意）profile。
2. 已安装并登录 `arkcli`（`@volcengine/ark-cli`），账号下有生效的 Coding Plan / Agent Plan 席位：
   ```bash
   arkcli auth login volc-sso
   arkcli usage plan --format json   # 能返回 JSON 即可
   ```
3. 改动 `src/client.js` 后需要 `pnpm build`（或 `node build.mjs`）重新生成 `lib/client.js`。

插件**不保存任何凭据**：它每次通过你本机的 `arkcli` 读取你自己账号的用量。

## 安装

在包目录的**上一级**执行（相对路径按你调用 `dsh` 的目录解析）：

```bash
cd /path/to
dsh plugin --profile web add ./dsh-ark-usage-widget
```

`dsh plugin` 会把包链接进 profile 的依赖，并因为包声明了 `dsh.bundle`，把它追加到 `dsh.profile.bundles` 层列表。然后**重启 DSH** 生效。

也可以从其他来源安装（`lib/client.js` 是预构建产物，随包分发，无需在目标机上构建）：

```bash
pnpm pack                      # 在包目录内打出 dsh-ark-usage-widget-0.2.0.tgz
dsh plugin --profile web add ./dsh-ark-usage-widget-0.2.0.tgz
# 或 git：dsh plugin --profile web add github:<you>/dsh-ark-usage-widget
# 或 npm：dsh plugin --profile web add dsh-ark-usage-widget
```

## 首次运行

1. **重启 DSH**。
2. 侧边栏底部（设置下方）直接出现用量行 —— **无审批、无提示、无自动对话**。

## 更新

- 只改 **两个源文件**：`index.js`（host 半，数据链路）与 `src/client.js`（浏览器 UI）。
- 改了 `src/client.js` 后先 `node build.mjs` 重新生成 `lib/client.js`（构建产物**已提交**，克隆即可用）。
- 以本地目录安装时，profile 依赖指向本目录，改完**重启 DSH** 即生效。
- 以 tarball / git / npm 安装时，改完重新打包并 `dsh plugin --profile web add`（升级覆盖）后重启。

## 卸载

```bash
dsh plugin --profile web remove dsh-ark-usage-widget
```

同时移除依赖与 `dsh.profile.bundles` 中的对应层。之后重启 DSH 即卸载。

## 工作原理

- **HOST 半**（`index.js`，组合插件行）：注册同源路由 `GET /ark-usage`，经 `connection.requestRejection` 信任围栏（Host/Origin 围栏 + 登录 cookie，与 open-in-app 相同的安全形状）后，调用本机 `arkcli` 读取账号用量（60s 缓存），返回 JSON。
- **CLIENT 半**（`src/client.js` → `lib/client.js`，`dsh.client` 声明）：**静态浏览器插件**。DSH 的 client-modules 服务在进程启动时扫描 loader 里的 `dsh.client` 行、运行时把预构建的 `lib/client.js` 组成 `window.__DSH_BOOT__` 并 serve —— 与每个内置 UI 行（ui-settings、ui-sidebar…）完全相同的机制。插件向 `sidebar.footer.action` 槽位注册一行 UI，数据经 `fetch('/ark-usage')` 读取，60s 轮询。
- **为什么没有「每次启动自动注入 cordis-host-runner 上下文 + 自动对话」**：旧版本把 widget 作为**动态 Cordis 插件**在会话启动时自动 define/run。cordis-host-runner 的设计是每次 run 结算后向所属会话 `agent.steer`（带 wake 的用户消息，source 为 `cordis-host-runner`）—— 于是每次 DSH 启动都会向当前会话注入一条该上下文并自动叫醒模型开一轮对话。本版本完全不走动态 runner：没有 define/run/request-run/审批/steering，浏览器半等同于静态内置，用户全程无感。这也是 README 旧版提到「静态内置需重建 web 应用」的替代方案 —— 借助 client-modules 的**运行时** `dsh.client` 扫描，bundle 自带的预构建 client 行不需要重建 DSH 的 web 产物。
- 小部件是**全局 UI**：显示账号级用量，与具体会话无关，进程内只渲染一次。

## 说明与限制

- 仅适用于**火山方舟 Coding / Agent Plan** 席位；无席位时显示「无订阅」。
- 数据链路依赖 `arkcli`，未安装或未登录时浮层会给出对应提示。
- 浏览器端代码按「随包分发的受信静态代码」运行，**无人工审批** —— 请只安装你信任的包。
- 侧边栏位置的实现依赖 DSH 的界面扩展点；DSH 大幅改版后可能需要适配。
- `/ark-usage` 路由沿用 DSH 的连接信任围栏：仅同源页面可读，DSH 内部接口变动时数据链路可独立降级（浮层显示错误与重试）。

## 分享

推到 Git 仓库，其他人 `clone` 后按上文安装即可（tarball / git 源皆可，`lib/client.js` 已随包分发）。
