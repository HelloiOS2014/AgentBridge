# AgentBridge

**本机多 Agent 委派桥**：让 Codex、Claude Code、Grok Build 在对话里把 plan / review / rescue 任务委派给彼此，以及 Antigravity CLI。

- 装 marketplace → 想桥谁装谁 → 说一句话即可，**零手动安装命令、无需 npm、无需 export**
- 所有委派**只读默认**，显式 `--write` 才可写；禁止 bare / yolo / 危险 bypass

## 快速开始（复制即用）

### Claude Code

```
/plugin marketplace add https://github.com/HelloiOS2014/AgentBridge
/plugin install antigravity-bridge@agent-bridge-claude
```

装完直接说：「让 Antigravity 看这张图」「让 Codex plan 一下这个重构」。

### Codex

```bash
codex plugin marketplace add https://github.com/HelloiOS2014/AgentBridge --ref main
```

然后在 Codex App 的 **Plugins** 里 Add：`antigravity-bridge`（或 `claude-bridge` / `grok-bridge`）。

### Grok

在 Grok 里添加本仓库的 marketplace，装需要的 bridge（`claude-bridge` / `codex-bridge` / `antigravity-bridge`）。

首次调用自动完成引擎就位（插件自包含引擎，自举到 `~/.agent-bridge/engine/`，多 Host 共用一份，升级自动覆盖）。无需 export、无需 npm。

## 更新

**用户侧（装过一次，之后升级零手动命令）**：

| Host | 刷新 marketplace | 更新插件 |
|------|------------------|----------|
| **Claude Code** | `/plugin marketplace update` | `/plugin install <target>-bridge@agent-bridge-claude`（或 /plugin 界面更新） |
| **Codex** | 重跑 `codex plugin marketplace add <url> --ref main` | Plugins 面板更新 |
| **Grok** | 按其插件机制刷新 | 同左 |

更新插件后，**下次触发 skill 自动完成引擎升级**：自举检测插件版本 ≠ 引擎版本 → 自动覆盖 `~/.agent-bridge/engine/` 与 wrapper。无需任何手动命令。

> ⚠️ **两层更新别混淆**：`/plugin update` 只更新插件缓存；**运行中的引擎（`~/.agent-bridge/engine/`）需要显式更新**。更新插件后执行：
>
> ```bash
> agent-bridge update --json          # 引擎 ≥ 0.1.7 后可用（wrapper 直接调）
> # 旧引擎（< 0.1.7）不认识 update 命令——直接用插件里的新引擎：
> node "$(dirname "$(find ~/.claude/plugins -path '*antigravity-bridge*' -name version -type f 2>/dev/null | sort -V | tail -n1)")/src/cli.mjs" update --json
> ```
>
> `agent-bridge update` 从已安装插件（最高版本）重建引擎与 wrapper——不依赖 skill 触发时机，任何引擎版本都能用插件 src 形式执行。skill 首次触发的自举仍会兜底升级，但不再作为主路径。

**发布侧（维护者）**：改引擎/模板 → **bump `package.json` version**（自举按版本决定是否覆盖用户引擎；不 bump 用户机器不更新，`generate:skills` 会强制拒绝）→ `npm run generate:skills` → `npm run check:manifest` → commit + push。

## 使用示例

```text
「让 Codex plan 一下这个重构」        → codex-plan
「让 Grok review 当前改动」           → grok-review
「让 Antigravity 查一下这个报错」      → antigravity-rescue（只读诊断）
「让 Antigravity 修复这个 bug」       → antigravity-rescue --write（显式写意图）
「分析这张图 …」（附文件路径）        → 自动走附件流程（--attach），只读隔离分析
```

```bash
# 也可以直接调 CLI（wrapper 由自举生成，host 已锁定）
"$HOME/.agent-bridge/bin/agent-bridge-claude" codex plan --json --prompt "重构方案"
agent-bridge status <job-id> --json        # 查任务（轻量）
agent-bridge result <job-id> --full        # 取完整结果（默认截断防撑爆上下文）
agent-bridge --background …                # 后台 worker，status/cancel 跟踪
```

## 可桥接矩阵

| 你在用 ↓ \ 可桥接到 → | Claude | Codex | Grok | Antigravity |
|----------------------|:------:|:-----:|:----:|:-----------:|
| **Codex**            | ✅     | ❌    | ✅   | ✅          |
| **Claude Code**      | ❌     | ✅    | ✅   | ✅          |
| **Grok Build**       | ✅     | ✅    | ❌   | ✅          |

❌ = self：不提供产品入口，Runtime 也会拒绝。

## 安全模型

| 机制 | 说明 |
|------|------|
| **只读默认** | plan / review / rescue 全部只读（tools 白名单 / sandbox / 隔离快照 + 探针）；改代码必须显式 `--write` |
| **Host lock** | 委派经写死宿主身份的 wrapper 进入，冒充宿主会被拒绝 |
| **防递归** | `NESTED` 标记 + self 拒绝（exit 3/4） |
| **禁危险旗标** | `--bare` / `--yolo` / `--dangerously-bypass-*` 全局禁止 |
| **禁 MCP** | 项目永久不采用 MCP 作为接口（核心路径仅 CLI 命令） |
| **防上下文爆炸** | 回传截断（磁盘存全量，`result --full` 取全文）；job 7 天 TTL 自动清理 |
| **外部文件** | `--attach` 只读复制进隔离快照/工作区，跑完清理（write 任务保留产出） |

## 架构

```text
Host skills（marketplace 插件，按平台拆、不含 self）
    → wrapper（host lock）→ agent-bridge CLI
    → Core（job / state / safety / TTL）
    → Adapter（claude | codex | grok | antigravity）
    → 本地 CLI headless（sandbox / 隔离快照）
```

## 文档

| 文档 | 说明 |
|------|------|
| [docs/getting-started.md](./docs/getting-started.md) | 快速开始 |
| [docs/design.md](./docs/design.md) | 设计真源（架构 / 安全模型 / 契约） |
| [docs/agent-differences.md](./docs/agent-differences.md) | 各 Agent CLI 差异与已知坑 |

## 兼容与迁移

- **入口**：marketplace 唯一通道；`agent-bridge install` 是补充通道（自动化 / 批量），不替代 marketplace
- **旧环境变量**：`CLAUDE_COMPANION_*` / `ANTIGRAVITY_COMPANION_*` 迁移期继续可用（`AGENT_BRIDGE_*` 优先）
- **job 状态**：旧布局不自动迁移，可查可 `cleanup`

## 开发

```bash
npm test                 # 128 个用例（fake CLI 驱动，无需真实凭证）
npm run check:manifest   # 发行面校验（无 self、插件引擎一致性）
npm run generate:skills  # 改模板/引擎后重新生成插件产物（版本闸门：未 bump 拒绝）
```

发布更新流程见上方「更新」节。

状态：Phase 0-5 全部交付（除可选 Codex L3 app-server）；硬化、回传卫生、marketplace 自足、附件、真机验收完成。

## 许可

MIT
