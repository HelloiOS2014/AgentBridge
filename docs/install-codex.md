# 在 Codex 上安装 AgentBridge

## 推荐：CLI install（一条命令）

```bash
# Core 已 npm link / 全局安装
agent-bridge install --host codex --targets claude,grok,antigravity --apply
agent-bridge doctor --host codex
```

Skill 装到 `~/.agent-bridge/skills/codex/`。若 Codex 只扫插件目录，可同时用 marketplace（下节）或把该目录配进 Codex skills 路径。

## Marketplace（插件货架）

本仓库根目录：

```text
.agents/plugins/marketplace.json
```

货架插件（**无 Codex self**）：

- `claude-bridge`
- `grok-bridge`
- `antigravity-bridge`

### Codex CLI

```bash
codex plugin marketplace add <本仓库 git URL> --ref main
```

然后在 Codex App **Plugins** 里按需 Add 上述插件。

### 仍需 install 一次

Marketplace 提供 skill 文案；wrapper 由：

```bash
agent-bridge install --host codex --apply
```

生成。Skill 调用：

```bash
"$HOME/.agent-bridge/bin/agent-bridge-codex" claude plan --json --prompt "..."
```

## 对话示例

- Ask Claude to plan this architecture  
- Ask Grok to review my current changes  
- Ask Antigravity to investigate this failure (read-only)  

## 注意

- 不要装「codex-bridge」到 Codex Host（货架里也没有）  
- Companion 在 Codex 沙箱里可能需要 escalated 权限（与旧 claude-companion 相同）  
