# OpenCode 会话 Hover 消息预览外挂

给**官方 OpenCode 桌面版**（无需改源码、无需重新编译）加回一个被官方移除的功能：

> 鼠标悬停左侧会话项 → 弹出浮层，列出该会话里**我发送过的所有消息** → 点击其中一条 → 跳转到该会话并滚动定位到那条消息。

![演示](./docs/demo.gif)

这个功能官方曾经有（组件 `SessionHoverPreview` + `MessageNav`），在 PR #20708「better subagent experience」(2026-04-07) 重构侧栏时被移除。本外挂用**运行时注入**的方式把它复刻回来。

---

## 零、安装（首次 / 分享给别人）

这个外挂**可移植**：脚本里没写死用户名（`hover-helper.js` 用 `$HOME`，启动器用 `dirname "$0"` 定位自身），所以别人装的时候**不用改脚本内容**，照下面 3 步即可。

### 1. 装 bun（唯一需要装的依赖）

```bash
curl -fsSL https://bun.sh/install | bash
```

装完确认：`~/.bun/bin/bun -v` 能打印版本即可。其余（bash/curl/osascript 等）macOS 自带，**无需 npm install**（脚本只用 bun 内置的 WebSocket/fetch/sqlite）。

### 2. 放好这个文件夹

把整个 `hover-plugin` 文件夹拷到对方电脑的：

```
~/.local/share/opencode/hover-plugin/
```

> 放别的目录也行（脚本能自定位），但本说明与示例都按这个路径写，建议保持一致。目录不存在就先建：`mkdir -p ~/.local/share/opencode`。

然后给启动器加可执行权限：

```bash
chmod +x ~/.local/share/opencode/hover-plugin/start-opencode-hover.command
```

### 3. 配一个启动方式（任选其一）

> 关键前提：必须**带调试端口启动** OpenCode 才能注入，普通双击 Dock 图标启动的实例无法注入（见「一」）。所以日常要用下面的启动器来开 OpenCode。

**A. 最简单——终端直接跑**（先验证能不能用）

```bash
bash ~/.local/share/opencode/hover-plugin/start-opencode-hover.command
```

**B. Keysmith / Raycast / Alfred 快捷键**（推荐，静默后台）

新建一个 **Run AppleScript** 动作，脚本一行（把 `<你的用户名>` 换成对方的家目录用户名，或直接用 `$HOME`）：

```applescript
do shell script "nohup bash $HOME/.local/share/opencode/hover-plugin/start-opencode-hover.command >/tmp/opencode-hover.log 2>&1 &"
```

绑个全局快捷键即可。首次运行若弹「自动化权限」请求 → 允许。

### 前提检查清单
- [ ] 已装官方 **OpenCode.app**（默认在 `/Applications/OpenCode.app`；装到别处需改启动器里 `APP=` 一行）。
- [ ] 已装 **bun**。
- [ ] `hover-plugin` 文件夹完整（`start-opencode-hover.command` / `hover-helper.js` / `inject.js` 三个必需文件都在）。

装好后用法见下方「一」。验证：启动后把鼠标停在左侧会话上约 0.5 秒，浮层弹出即成功；否则看 `/tmp/opencode-hover.log` 排错（见「七」）。

---

## 一、怎么用（日常）

⚠️ 关键前提：CDP 注入要求 OpenCode **带远程调试端口启动**。普通双击 Dock 图标启动的实例**没有端口、无法注入**（这是 Electron 限制，端口只能在启动时由命令行参数加，无法给已运行的进程补上）。

所以以后想用这个功能，用启动器开 OpenCode。

**方式一：Keysmith 快捷键启动**（当前在用，推荐）

在 [Keysmith](https://keysmith.app) 里建一个 **Run AppleScript** 动作，脚本就一行：

```applescript
do shell script "nohup bash $HOME/.local/share/opencode/hover-plugin/start-opencode-hover.command >/tmp/opencode-hover.log 2>&1 &"
```

绑定一个全局快捷键（例如 `⌃⌥⌘O`），命名「启动 opencode 带 hover」。按一下即静默后台启动并注入，不开终端窗口，日志写到 `/tmp/opencode-hover.log`。

**方式二：终端直接跑**
```bash
bash ~/.local/share/opencode/hover-plugin/start-opencode-hover.command
```

无论哪种，启动器都会自动：
1. 先停掉已有的注入助手（保证全局只有一个实例）
2. 若 OpenCode 正普通运行（无调试端口）→ 退出它
3. 带调试端口 `9222` 重启官方 OpenCode（已带端口则跳过）
4. 等端口就绪 → 注入脚本 + 挂上助手

启动后，把鼠标停在左侧任意会话上约 0.5 秒，浮层就会出现。

### 怎么停
**不用手动停**——关闭 OpenCode 后，助手会**自动检测到端口消失并自行退出**（约 5 秒内），不留残留进程。

---

## 二、效果细节

- **触发**：hover 会话项停留 **0.5s** 才弹（避免划过就闪）；移开或划到别的会话会重新计时。
- **浮层内容**：标题「我发送的消息 (N)」+ 按时间顺序列出每条用户消息的文本，每条之间有淡分割线，单条最多显示 3 行。
- **点击跳转**：点某条 → 导航到该会话并滚动定位到对应消息（利用官方的 hash 滚动机制，会自动把虚拟列表里的目标渲染出来）。
- **主题自适应**：浮层颜色读 OpenCode 自身的主题（`<html data-color-scheme>`），跟随「设置 → 外观 → 配色方案」深/浅切换，**不看系统外观**（二者可能不一致）。切换主题时通过 `MutationObserver` 实时变色。
- 鼠标移到浮层上不会消失；离开浮层和会话项才收起。

可调项见下方「五、自定义」。

---

## 三、文件说明

工作目录：`~/.local/share/opencode/hover-plugin/`

| 文件 | 作用 | 必需 |
|---|---|---|
| `start-opencode-hover.command` | 启动器：停旧助手 → 带调试端口起 OpenCode → 挂助手 | ✅ |
| `hover-helper.js` | CDP 助手（bun）：注入脚本、读 `opencode.db` 取消息、回填渲染进程、OpenCode 退出后自动停止 | ✅ |
| `inject.js` | 注入渲染进程的前端脚本：hover 检测、浮层 UI、主题自适应、点击跳转 | ✅ |
| `README.md` | 本说明 | — |

启动入口：Keysmith 快捷键（见「一」），脚本内仅一行 `nohup bash …start-opencode-hover.command …`。
运行日志：`/tmp/opencode-hover.log`。

### 依赖

| 依赖 | 用途 | 获取 |
|---|---|---|
| **bun** | 跑 `hover-helper.js`（CDP 客户端 + `bun:sqlite` 读库） | `~/.bun/bin/bun`，没有则装：`curl -fsSL https://bun.sh/install \| bash` |
| **官方 OpenCode.app** | 被注入的目标（Electron 桌面版） | `/Applications/OpenCode.app` |
| **bash / curl / osascript / pgrep / pkill** | 启动器脚本所用 | macOS 自带 |
| **Keysmith**（可选） | 绑全局快捷键触发启动器 | https://keysmith.app（也可换 Raycast/Alfred/自动操作，或终端直接跑） |

> 说明：`hover-helper.js` 用的是 **bun 内置** 的 `WebSocket`、`fetch`、`bun:sqlite`，**无任何 npm 包依赖**，不需要 `npm install`。`sqlite` 也不依赖系统命令，直接用 bun 内置驱动读 `opencode.db`。

---

## 四、工作原理

```
┌─────────────────────────────┐        CDP (ws://127.0.0.1:9222)        ┌────────────────────┐
│  官方 OpenCode (Electron)    │  ◀──────────────────────────────────▶  │  hover-helper.js   │
│  渲染进程 (oc://renderer)    │                                         │  (bun 进程)        │
│                             │   ① 注入 inject.js                       │                    │
│  inject.js:                 │   ② hover → 调用 binding 请求            │  读 opencode.db    │
│   - 监听 [data-session-id]  │ ───────────────────────────────────▶    │  取该会话用户消息  │
│   - hover 弹浮层            │   ③ 把消息写回共享 DOM 属性              │                    │
│   - 点击 → #message-<id>    │ ◀───────────────────────────────────    │  端口消失则自停    │
└─────────────────────────────┘                                         └────────────────────┘
```

1. **启动**：OpenCode 带 `--remote-debugging-port=9222` 启动，暴露 Chrome DevTools 协议(CDP)。
2. **注入**：`hover-helper.js` 通过 CDP 把 `inject.js` 注入渲染进程主世界，并注册 binding `__opencodeHoverBinding`；整页重载时自动重注入。
3. **数据请求**：用户 hover 会话项，`inject.js` 调用 binding 把会话 ID 发给助手。
4. **读库**：助手只读查 `~/.local/share/opencode/opencode.db`，取该会话所有 `role=user` 的消息文本（排除 synthetic/ignored）。
5. **回填**：助手把结果（base64）写到渲染进程 `document.documentElement` 的属性上，`inject.js` 轮询读取并渲染浮层。
6. **跳转**：点击某条消息，`inject.js` 构造 `/<slug>/session/<id>#message-<msgId>` 链接并点击，交给官方 `useSessionHashScroll` 完成「reveal 虚拟列表项 + 滚动定位」。
7. **自停**：助手成功探到过端口后，若连续 3 次（约 4.5s）探不到端口，判定 OpenCode 已退出，自行结束。

### 为什么数据走「共享 DOM」而不是 `window`
Electron 开启了 `contextIsolation`，渲染进程里有多个 JS world（主世界、隔离世界），它们**共享同一个 DOM，但 `window` 各自独立**。早期版本把数据回填挂在 `window` 上，结果注入在 A world、回填到 B world 对不上。改成写到**共享 DOM 属性**后彻底稳定。安装锁也用 DOM 属性 `data-ophv-installed`，保证跨 world 只装一次。

### 数据来源为什么用数据库而不是 HTTP API
直接读 `opencode.db`（只读）避免了 API 的鉴权 / 跨域 / 实例路由等不确定项，最稳。会话/消息/消息片段分别在 `session` / `message` / `part` 表，用户消息文本来自 `part.data` 里 `type=text` 的片段。

### 主题（深/浅）适配怎么做的
**不看系统外观，读 OpenCode 自身的主题标记。** 关键点：OpenCode 的「配色方案」是 App 内单独设置，可与 macOS 系统外观不一致（例如系统浅色、OpenCode 深色），所以 `prefers-color-scheme` 不可靠。

探测发现官方把主题标记在 `<html>` 上：

```html
<html data-theme="oc-2" data-color-scheme="dark"> ... </html>
```

`inject.js` 的做法：
1. **读取**：`applyTheme()` 读 `document.documentElement` 的 `data-color-scheme`（`dark` / `light`），据此在 `<html>` 上写一个自己的镜像属性 `data-ophv-scheme`；读不到才回退到系统 `prefers-color-scheme`。
2. **样式**：浮层颜色全部用 CSS 变量（`--ophv-bg` / `--ophv-fg` / `--ophv-muted` / `--ophv-border` / `--ophv-sep` / `--ophv-hover` / `--ophv-shadow`），由选择器 `:root[data-ophv-scheme="dark"|"light"] .ophv-card{…}` 提供两套取值；另有一份「属性未就绪时按深色」的兜底默认。
3. **实时跟随**：用 `MutationObserver` 监听 `<html>` 的 `data-color-scheme` / `data-theme` 变化，用户在「设置 → 外观」切换主题时，`data-ophv-scheme` 立即更新，浮层颜色随之切换，无需重载。

> 为什么用「镜像属性 `data-ophv-scheme`」而不直接用官方的 `data-color-scheme`：多套一层是为了在官方属性缺失/改名时仍能由 JS 兜底赋值，CSS 选择器只认我们自己的属性，更稳。

---

## 五、自定义

改完 `inject.js` 后，需要**重启助手并重载渲染进程**才生效（最简单：关掉 OpenCode 让助手自停，再按 Keysmith 快捷键重来一遍）。

| 想改什么 | 改哪里（`inject.js`） |
|---|---|
| hover 延迟 | `var SHOW_DELAY = 500;`（毫秒） |
| 浮层尺寸/字号/圆角 | `.ophv-card{...}` 里的 `max-width/min-width/max-height/font-size` |
| 深色配色 | `:root[data-ophv-scheme="dark"] .ophv-card{ --ophv-bg / --ophv-fg / … }` |
| 浅色配色 | `:root[data-ophv-scheme="light"] .ophv-card{ --ophv-bg / --ophv-fg / … }` |
| 单条最多显示行数 | `.ophv-item{ -webkit-line-clamp:3; }` |
| 每条文本截断长度 | `hover-helper.js` 里 `r.text.length > 200 ? ...slice(0,200)...` |
| 端口号 | 启动器里 `PORT=9222`；助手默认 9222（或设环境变量 `OPENCODE_HOVER_PORT`） |
| 退出判定的容忍次数 | `hover-helper.js` 里 `++misses >= 3` |

---

## 六、局限与注意

- **必须用启动器（Keysmith 快捷键 / 终端跑脚本）启动**才有调试端口；普通双击 Dock 图标启动的实例无法注入。
- 这是**外挂**，不修改 `OpenCode.app` 任何文件，不破坏官方签名；官方升级后通常仍可用（除非官方改了 `data-session-id` / `data-message-id` / `data-color-scheme` / 会话路由 / hash 滚动机制，那时需按本文「四」对应处微调）。
- 数据库结构若被官方新版迁移改动（如 `part`/`message` 表结构变化），需相应更新 `hover-helper.js` 的查询。
- 主题适配依赖官方 `<html data-color-scheme>` 标记；若官方改了属性名，浮层会回退到系统外观（可能与 OpenCode 内设主题不一致），届时按「四 · 主题适配」更新读取逻辑。
- 仅在 macOS + 官方桌面版 1.15.x 上验证过。
- Keysmith 首次运行该脚本可能弹自动化权限请求 → 允许即可。

---

## 七、排错

| 现象 | 排查 |
|---|---|
| 按快捷键后没反应 / 浮层不出现 | 看日志 `/tmp/opencode-hover.log` 是否有 `[helper] attached`；`curl -s http://127.0.0.1:9222/json/version` 是否通 |
| 端口起不来 | 该版本可能禁用了远程调试（日志会提示）；确认是用启动器（快捷键/脚本）、而非双击 Dock 图标启动 |
| 浮层出现但点击不跳转 | 多半是官方改了会话路由或 hash 滚动；检查侧栏 `<a>` 的 href 格式与 `#message-<id>` 锚点 |
| 浮层数据为空 | 该会话可能确实没有用户文本消息；或数据库结构变了，检查 `hover-helper.js` 的 SQL |
| 浮层颜色与当前主题不符 | 官方可能改了 `data-color-scheme` 标记；在 DevTools 看 `<html>` 是否还有该属性，按「四 · 主题适配」更新 `applyTheme()` |
| 想手动停助手 | `pkill -f hover-helper.js`（一般不用，关 OpenCode 会自动停） |

---

_生成于 2026-06-03，2026-06-03 更新（改用 Keysmith 快捷键启动；浮层支持深/浅主题自适应）。复刻自官方移除前版本（commit `5ea95451d` 的 `SessionHoverPreview`）。_
