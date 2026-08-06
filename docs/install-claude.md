# 在 Claude Code 上安装 AgentBridge（Marketplace）

Marketplace 是唯一安装流程：**装 marketplace → 按需 `/plugin install` → 即用**。无需 `npm i -g`，无需手动安装命令。

## 1. 添加 marketplace

在 Claude Code 里：

```text
/plugin marketplace add /path/to/AgentBridge
```

（或仓库 git URL。）

货架（**无 Claude self**）：`codex-bridge`、`grok-bridge`、`antigravity-bridge`。

## 2. 按需安装 bridge 插件

```text
/plugin install antigravity-bridge
```

想用哪个桥就装哪个，例如「让 Codex plan / 让 Grok review / 让 Antigravity 查问题」分别装对应插件。装完重开（或 `/plugin` 面板启用）让 skill 生效。

## 3. 即用（首次自动自举）

直接说：「让 Antigravity 看一下这个架构」。

skill 首次调用会自动把插件内自带的完整引擎复制到 `~/.agent-bridge/engine/` 与 `~/.agent-bridge/bin/agent-bridge-claude`（幂等；引擎带版本标记，插件升级后自动覆盖更新，无感）。无需任何手动安装命令。

## 对话示例

- Ask Codex to review this branch
- Ask Grok to plan the migration
- Ask Antigravity to fix the failing test（明确 fix → skill 才可 `--write`）
