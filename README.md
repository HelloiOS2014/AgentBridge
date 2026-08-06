# AgentBridge

**本机多 Agent 委派桥**：让 Codex、Claude Code、Grok Build 在对话里把 plan / review / rescue 任务委派给彼此，以及 Antigravity CLI。

- 装 marketplace → 想桥谁装谁 → 说一句话即可，**零手动安装命令、无需 npm、无需 export**
- 所有委派**只读默认**，显式 `--write` 才可写；禁止 bare / yolo / 危险 bypass

## 快速开始（3 步）

1. **装 marketplace**：在你用的 Host 里添加本仓库
   - Claude Code：`/plugin marketplace add <本仓库>` · Codex / Grok 见[分 Host 文档](#分-host-安装)
2. **按需装插件**：`/plugin install <target>-bridge` —— 只要 Antigravity 就装 `antigravity-bridge`，只要 Grok 就装 `grok-bridge`，想桥谁装谁
3. **直接用**：对话里说「让 Antigravity 看这张图」「让 Codex plan 一下这个重构」

首次调用自动完成引擎就位（插件自包含完整引擎，自举到 `~/.agent-bridge/engine/`，**多 Host 共用一份**，升级自动覆盖）。无需 export 任何变量。

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

## 分 Host 安装

| Host | 文档 |
|------|------|
| Codex | [docs/install-codex.md](./docs/install-codex.md) |
| Claude Code | [docs/install-claude.md](./docs/install-claude.md) |
| Grok Build | [docs/install-grok.md](./docs/install-grok.md) |

## 文档

| 文档 | 说明 |
|------|------|
| [docs/getting-started.md](./docs/getting-started.md) | 快速开始 |
| [docs/design.md](./docs/design.md) | 设计真源（架构 / 安全模型 / 契约） |
| [docs/agent-differences.md](./docs/agent-differences.md) | 各 Agent CLI 差异与已知坑（如 agy `--model` 坏路） |
| [docs/reference-codex-plugin-cc.md](./docs/reference-codex-plugin-cc.md) | 参考实现分析（勿整搬） |

## 兼容与迁移

- **入口**：marketplace 唯一通道；`agent-bridge install` 是补充通道（自动化 / 批量），不替代 marketplace
- **旧环境变量**：`CLAUDE_COMPANION_*` / `ANTIGRAVITY_COMPANION_*` 迁移期继续可用（`AGENT_BRIDGE_*` 优先）
- **job 状态**：旧布局不自动迁移，可查可 `cleanup`

## 开发

```bash
npm test                 # 128 个用例（fake CLI 驱动，无需真实凭证）
npm run check:manifest   # 发行面校验（无 self、插件引擎一致性）
npm run generate:skills  # 改模板/引擎后重新生成插件产物
```

状态：Phase 0-5 全部交付（除可选 Codex L3 app-server）；硬化、回传卫生、marketplace 自足、附件、真机验收完成。

## 许可

MIT
