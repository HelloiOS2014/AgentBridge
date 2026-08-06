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

## 用户怎么用（不需要手写 export）

完整步骤：**[docs/getting-started.md](./docs/getting-started.md)**  

分 Host：  
[Codex](./docs/install-codex.md) · [Claude](./docs/install-claude.md) · [Grok](./docs/install-grok.md)

```bash
cd /path/to/AgentBridge && npm link
agent-bridge install --host codex --targets claude,antigravity --apply
agent-bridge doctor --host codex
# 然后在 Codex 对话里：「让 Claude plan …」
```

**不需要** `export` 任何变量。wrapper / skill 绝对路径由 install 写好；CLI 自动发现本机 `claude`/`agy`/`grok`/`codex`。

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
- [ ] Phase 5（可选）：Codex L3 app-server、真后台 worker
- [x] **硬化收尾**：job 索引原子写 + 扫描兜底、antigravity 忽略条目过滤、死代码清理、git-context 真仓测试
- [x] **CLI 表面收敛**：storage / cleanup / status --all / install --remove

## 许可

拟 MIT（与参考实现一致，实现时写入 `package.json` / `LICENSE`）。
