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
├── package.json       # 包声明（dsh.bundle）
├── cordis.patch.yml   # 安装时注入的插件配置
├── index.js           # 启动引导
└── code.js            # 小部件源码（唯一需要修改的文件）
```

## 前置条件

1. 已安装 DSH（`dsh` CLI 在 PATH 上），使用 `web`（或任意）profile。
2. 已安装并登录 `arkcli`（`@volcengine/ark-cli`），账号下有生效的 Coding Plan / Agent Plan 席位：
   ```bash
   arkcli auth login volc-sso
   arkcli usage plan --format json   # 能返回 JSON 即可
   ```
3. `pnpm` 在 PATH 上（`dsh plugin` 在 profile 目录内转发给 pnpm）。

插件**不保存任何凭据**：它每次通过你本机的 `arkcli` 读取你自己账号的用量。

## 安装

在包目录的**上一级**执行（相对路径按你调用 `dsh` 的目录解析）：

```bash
cd /path/to
dsh plugin --profile web add ./dsh-ark-usage-widget
```

`dsh plugin` 会把包链接进 profile 的依赖，并因为包声明了 `dsh.bundle`，把它追加到 `dsh.profile.bundles` 层列表。然后**重启 DSH** 生效。

也可以从其他来源安装（无需构建，因为本包不带构建脚本）：

```bash
pnpm pack                      # 在包目录内打出 dsh-ark-usage-widget-0.1.0.tgz
dsh plugin --profile web add ./dsh-ark-usage-widget-0.1.0.tgz
# 或 git：dsh plugin --profile web add github:<you>/dsh-ark-usage-widget
# 或 npm：dsh plugin --profile web add dsh-ark-usage-widget
```

## 首次运行

1. **重启 DSH**。
2. 侧边栏底部（设置下方）直接出现用量行 —— **无需手动授权**，插件在启动时自动完成加载。
3. 若自动加载意外失败（如 DSH 内部接口变动），会回退到标准审批流：界面上点一次**允许**即可。

> 授权在 DSH 中默认不落盘、每次进程重新确认，是保护「AI 动态创建的浏览器代码」的安全边界。本插件通过受信配置自启动加载，浏览器端代码**无提示运行**，请只放入你信任的代码。

## 更新

只改**一个文件**：包目录里的 `code.js`（内含 `HOST_CODE` / `CLIENT_CODE` 两段插件源码）。

- 以本地目录安装时，profile 依赖指向本目录，改完**重启 DSH** 即生效。
- 以 tarball / git / npm 安装时，改完重新打包并 `dsh plugin --profile web add`（升级覆盖）后重启。

## 卸载

```bash
dsh plugin --profile web remove dsh-ark-usage-widget
```

同时移除依赖与 `dsh.profile.bundles` 中的对应层。之后重启 DSH 即卸载。

## 工作原理

- 小部件由本包在 DSH 启动时自动注册为一个动态插件：后端半区调用本机 `arkcli` 读取账号用量（60s 缓存），前端半区把 UI 挂到侧边栏底部「设置」下方。
- 小部件是**全局 UI**：显示账号级用量，与具体会话无关，每个进程只创建一次。
- 之所以采用「启动时动态加载」而非静态内置：浏览器端代码无法从已安装的包直接编入 DSH 随产品发布的网页产物，动态加载是「免审批 + 免重建」的折中。详细实现见 `index.js` 中的注释。

## 说明与限制

- 仅适用于**火山方舟 Coding / Agent Plan** 席位；无席位时显示「无订阅」。
- 数据链路依赖 `arkcli`，未安装或未登录时浮层会给出对应提示。
- 每次 DSH 重启由受信配置自动加载，**无需人工点击**；但浏览器端代码等同按配置信任（无人类确认）。
- 侧边栏位置的实现依赖 DSH 的界面扩展点；DSH 大幅改版后可能需要适配。

## 分享

推到 Git 仓库，其他人 `clone` 后按上文安装即可（tarball / git 源皆可）。
