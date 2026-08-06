# 在 Grok Build 上安装 AgentBridge（Marketplace）

Marketplace 是唯一安装流程：**装 marketplace → 按需装插件 → 即用**。无需 `npm i -g`，无需手动安装命令。

## 1. 添加 marketplace

按 Grok 当前的插件/marketplace 机制添加本仓库（货架无 Grok self）：`claude-bridge`、`codex-bridge`、`antigravity-bridge`。

## 2. 按需装插件

想用哪个桥就装哪个（如「让 Claude plan」装 `claude-bridge`）。skill 随插件进入 Grok 的 skills 目录。

## 3. 即用（首次自动自举）

直接说：「让 Antigravity 查一下这个报错（先不要改文件）」。

skill 首次调用会自动把插件内自带的完整引擎复制到 `~/.agent-bridge/engine/` 与 `~/.agent-bridge/bin/agent-bridge-grok`（幂等；引擎带版本标记，插件升级后自动覆盖更新，无感）。无需任何手动安装命令。

## 对话示例

- Ask Claude to plan this feature
- Ask Codex to review current changes
- Ask Antigravity to investigate without editing
