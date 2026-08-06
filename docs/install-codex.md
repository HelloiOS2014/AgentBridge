# 在 Codex 上安装 AgentBridge（Marketplace）

Marketplace 是唯一安装流程：**装 marketplace → 按需装插件 → 即用**。无需 `npm i -g`，无需手动安装命令。

## 1. 添加 marketplace

本仓库根目录：

```text
.agents/plugins/marketplace.json
```

```bash
codex plugin marketplace add <本仓库 git URL> --ref main
```

## 2. 按需装插件

在 Codex App **Plugins** 里 Add 需要的插件（**无 Codex self**）：

- `claude-bridge`
- `grok-bridge`
- `antigravity-bridge`

## 3. 即用（首次自动自举）

直接说：「让 Claude plan 一下这个重构」。

skill 首次调用会自动把插件内自带的完整引擎复制到 `~/.agent-bridge/engine/` 与 `~/.agent-bridge/bin/agent-bridge-codex`（幂等；引擎带版本标记，插件升级后自动覆盖更新，无感）。无需任何手动安装命令。

## 对话示例

- Ask Claude to plan this architecture
- Ask Grok to review my current changes
- Ask Antigravity to investigate this failure (read-only)

## 注意

- 不要装「codex-bridge」到 Codex Host（货架里也没有）
- Companion 在 Codex 沙箱里可能需要 escalated 权限
