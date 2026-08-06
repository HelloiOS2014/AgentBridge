# AgentBridge 快速开始

**你不需要 export 任何环境变量，也不需要 npm i -g。**

## 前提

1. 安装 Node.js ≥ 18.18
2. 本机装好并登录要用的 CLI（按需）：
   - Claude Code：`claude` + `claude auth login`
   - Codex：`codex` + `codex login`
   - Grok Build：`grok`（已登录）
   - Antigravity：`agy`

## 安装（Marketplace 唯一流程）

在你要用的 agent 里按 **[install-claude.md](./install-claude.md)** / **[install-codex.md](./install-codex.md)** / **[install-grok.md](./install-grok.md)**：

1. 添加 marketplace
2. 按需 `/plugin install`（或等效）装 bridge 插件
3. 即用——首次调用自动自举：插件自带完整引擎，skill 首次运行把它复制到 `~/.agent-bridge/engine/` 与 `~/.agent-bridge/bin/agent-bridge-<host>`（幂等，插件升级自动覆盖更新）

## 在对话里用

装好插件后，直接说例如：

- 「让 Claude plan 一下这个重构」
- 「让 Grok review 当前改动」
- 「让 Antigravity 查一下这个报错（先不要改文件）」
- 「帮我把这个截图给 Codex 看看」——skill 会用 `--attach` 把文件送进委派工作区

由 skill 调 wrapper，无需你手敲 CLI。

## 可选：给用户文件 / 图片

对话里给出文件路径时，skill 会以 `--attach <绝对路径>`（可重复）把文件复制进委派工作区：
- 只读任务（plan / review / 只读 rescue）：用完即清理
- `rescue --write`：附件保留在工作区（是产出），结果里报告路径

## 查任务

```bash
agent-bridge status <job-uuid> --json
agent-bridge result <job-uuid> --json
```

（`agent-bridge` 命令来自引擎 bin；也可用各 host wrapper。）

## 安全摘要

- 不会装「自己调自己」的 bridge
- plan/review/只读 rescue 不改仓库（各 Target 用 tools/sandbox/isolation）
- `rescue --write` 仅当用户明确要求改代码
- 禁止 bare / yolo / dangerously-bypass 主路径
