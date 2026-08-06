# AgentBridge

通用本机多 Agent 桥接：**让 Codex / Claude Code / Grok Build 委派任务给彼此，以及 Antigravity CLI**。

> 完整方案见 **[docs/design.md](./docs/design.md)**。  
> 差异矩阵（按文档/现网）：[docs/agent-differences.md](./docs/agent-differences.md)。  
> 参考（勿整搬）：[codex-agent-bridge](https://github.com/HelloiOS2014/codex-agent-bridge)（Codex→Claude/Agy）；[codex-plugin-cc](https://github.com/openai/codex-plugin-cc)（Claude→Codex，分析见 [docs/reference-codex-plugin-cc.md](./docs/reference-codex-plugin-cc.md)）。

## 核心约定

| 约定 | 说明 |
|------|------|
| **禁止自己套自己** | Host 是谁，marketplace / skills **不包含** 再调同一个 agent |
| **调用方自选安装** | 货架上架多个 Target Bridge，用户只装需要的 |
| **CLI-only** | 统一 `agent-bridge` 命令；第一期不用 MCP |
| **安全默认** | plan/review 只读；rescue 默认只读，显式 `--write` 才可写 |

## Host × Target 矩阵

| 你在用 ↓ \ 可桥接到 → | Claude | Codex | Grok | Antigravity |
|----------------------|:------:|:-----:|:----:|:-----------:|
| **Codex**            | ✅     | ❌    | ✅   | ✅          |
| **Claude Code**      | ❌     | ✅    | ✅   | ✅          |
| **Grok Build**       | ✅     | ✅    | ❌   | ✅          |

❌ = self，不提供产品入口；Runtime 也会拒绝。

## 架构（极简）

```text
Host skills（按平台拆 marketplace，不含 self）
    → agent-bridge <target> <command>
    → Core（job / state / safety）
    → Adapter（claude | codex | grok | antigravity）
    → 本地 CLI headless
```

## 用户怎么用（Marketplace 唯一流程，零手动安装命令）

完整步骤：**[docs/getting-started.md](./docs/getting-started.md)**  

分 Host（**入口：各平台原生 marketplace**，见发行说明）：
[Codex](./docs/install-codex.md) · [Claude](./docs/install-claude.md) · [Grok](./docs/install-grok.md)

```text
1. 装 marketplace（.claude-plugin/marketplace.json / .agents/plugins/marketplace.json）
2. 按需 /plugin install <target>-bridge（想桥谁装谁）
3. 对话里说「让 Claude plan …」→ 首次调用自动自举 → 即用
```

每个 bridge 插件自包含完整引擎（`src/` + 静态 wrapper + skills + 版本标记）；skill 首次运行把引擎自举到 `~/.agent-bridge/engine/` 与 `~/.agent-bridge/bin/agent-bridge-<host>`（幂等，插件升级自动覆盖更新）。**不需要** `export` 任何变量，不需要 `npm i -g`。CLI 自动发现本机 `claude`/`agy`/`grok`/`codex`。

## 发行说明（Phase 5）

- **入口：原生 marketplace 唯一通道**。从所在 Host 的 marketplace 添加本仓库并安装需要的 target bridge（`hosts/*` 货架）；**npm / `npm link` 不再是前提**。`agent-bridge install` 是统一补充通道（自动化 / 无 UI / 批量 targets），不替代 marketplace。
- **旧环境变量兼容期**：`CLAUDE_COMPANION_*` / `ANTIGRAVITY_COMPANION_*` 在迁移期继续可用（新名 `AGENT_BRIDGE_*` 优先），迁移期结束后移除。
- **job 状态不强制迁移**：旧布局 job 不自动迁移；新 job 落新布局，旧状态保留可查，`cleanup` 按需清理。

## 文档

| 文档 | 说明 |
|------|------|
| [docs/getting-started.md](./docs/getting-started.md) | **用户快速开始** |
| [docs/install-codex.md](./docs/install-codex.md) | Codex 安装 |
| [docs/install-claude.md](./docs/install-claude.md) | Claude Code 安装 |
| [docs/install-grok.md](./docs/install-grok.md) | Grok Build 安装 |
| [docs/design.md](./docs/design.md) | 设计真源 v2 |
| [docs/design-review-v3.md](./docs/design-review-v3.md) | 终审 |
| [docs/reference-codex-plugin-cc.md](./docs/reference-codex-plugin-cc.md) | 官方插件参考边界 |

## 仓库状态

- [x] 设计 v1 + 审查 + 差异调研 + codex-plugin-cc 参考
- [x] **设计 v2** + v3 终审
- [x] **Phase 0**：CLI 门禁、host lock/wrapper、install、manifest、UUID job 索引
- [x] **Phase 1**：Claude adapter + WriteProbe + job 落盘
- [x] **Phase 2a**：Antigravity adapter
- [x] **Phase 2b**：Grok adapter（read-only tools + sandbox + deny MCP/Edit）
- [x] **Phase 2c**：Codex L1 `exec` + L2 `exec review`（approval never，无 dangerously-bypass）
- [x] **Phase 3**：skill 模板 + generate + install 写用户 skill
- [x] **Phase 4**：getting-started / 分 Host 安装文档 + doctor + plugin 元数据
- [x] **Phase 5（worker）**：真后台 worker（`--background` / `--wait` / `cancel` 真实实现）；Codex L3 app-server 未做
- [x] **回传与存储卫生**：展示层截断（rendered 16KB / rawOutput 64KB，磁盘全量，`result --full` 取全文）、status 轻量、TTL 自动清理（7 天，跳过 running）、skill 摘要优先
- [x] **硬化收尾**：job 索引原子写 + 扫描兜底、antigravity 忽略条目过滤、死代码清理、git-context 真仓测试
- [x] **CLI 表面收敛**：storage / cleanup / status --all / install --remove
- [x] **Phase 5 余项**：`rescue --write` worktree 隔离、env allowlist（design §11.5）、迁移说明（见发行说明）
- [x] **marketplace 自足**：插件打包引擎（src+bin+skills+version）、skill 首用自举（幂等、版本防漂移）、check-manifest 引擎一致性断言、docs 重写为 marketplace 唯一流程
- [x] **外部文件附件**：`--attach`（可重复）、工作区/隔离快照落位、WriteProbe 顺序约束、只读清理 / write 保留产出

## 许可

拟 MIT（与参考实现一致，实现时写入 `package.json` / `LICENSE`）。
