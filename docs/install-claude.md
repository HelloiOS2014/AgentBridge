# 在 Claude Code 上安装 AgentBridge

## 推荐：CLI install

```bash
agent-bridge install --host claude --targets codex,grok,antigravity --apply
agent-bridge doctor --host claude
```

Skill 写入：`~/.claude/skills/<target>-plan` 等（绝对路径调 wrapper）。

重启 Claude Code 或新开会话以加载 skill。

## Marketplace（可选）

本仓库：

```text
.claude-plugin/marketplace.json
```

插件（**无 Claude self**）：`codex-bridge`、`grok-bridge`、`antigravity-bridge`。

```text
/plugin marketplace add <本仓库>
/plugin install codex-bridge@...
```

装 marketplace 后仍建议：

```bash
agent-bridge install --host claude --apply
```

## 对话示例

- Ask Codex to review this branch  
- Ask Grok to plan the migration  
- Ask Antigravity to fix the failing test（明确 fix → skill 才可 --write）  
