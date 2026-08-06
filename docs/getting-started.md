# AgentBridge 快速开始

**你不需要 export 任何环境变量。**

## 前提

1. 安装 Node.js ≥ 18.18  
2. 本机装好并登录要用的 CLI（按需）：
   - Claude Code：`claude` + `claude auth login`
   - Codex：`codex` + `codex login`
   - Grok Build：`grok`（已登录）
   - Antigravity：`agy`

## 安装 Core

开发中（本仓库）：

```bash
cd /path/to/AgentBridge
npm link
```

之后全局有 `agent-bridge` 命令。

## 按 Host 装一次

在你**主要使用**的 agent 上执行（示例：Codex）：

```bash
agent-bridge install --host codex --targets claude,grok,antigravity --apply
agent-bridge doctor --host codex --json
```

会自动：

- 生成 `~/.agent-bridge/bin/agent-bridge-codex`（内部带 host lock）  
- 尽量软链到 `~/.local/bin`  
- 把 skill 写到用户 skill 目录，**命令里是 wrapper 绝对路径**

其它 Host：

```bash
agent-bridge install --host claude --targets codex,grok,antigravity --apply
agent-bridge install --host grok --targets claude,codex,antigravity --apply
```

## 在对话里用

装好 skill / marketplace 后，直接说例如：

- 「让 Claude plan 一下这个重构」  
- 「让 Grok review 当前改动」  
- 「让 Antigravity 查一下这个报错（先不要改文件）」  

由 skill 调 wrapper，无需你手敲 CLI。

## 可选：Marketplace

| Host | 货架 |
|------|------|
| Codex | 见 [install-codex.md](./install-codex.md) |
| Claude | 见 [install-claude.md](./install-claude.md) |
| Grok | 见 [install-grok.md](./install-grok.md) |

Marketplace 装的是 skill/plugin 文案；**仍建议跑一次 `install --apply`**，保证本机有 wrapper。

## 查任务

```bash
agent-bridge status <job-uuid> --json
agent-bridge result <job-uuid> --json
```

## 安全摘要

- 不会装「自己调自己」的 bridge  
- plan/review/只读 rescue 不改仓库（各 Target 用 tools/sandbox/isolation）  
- `rescue --write` 仅当用户明确要求改代码  
- 禁止 bare / yolo / dangerously-bypass 主路径  
