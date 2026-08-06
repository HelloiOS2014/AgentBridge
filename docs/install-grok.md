# 在 Grok Build 上安装 AgentBridge

## 推荐：CLI install

```bash
agent-bridge install --host grok --targets claude,codex,antigravity --apply
agent-bridge doctor --host grok
```

Skill 写入：`~/.grok/skills/<target>-plan` 等。Grok 会扫描用户 skills 目录。

新开 Grok 会话后可用。

## 仓库内 skill 树

```text
hosts/grok/skills/
```

开发时也可把该目录链到 `~/.grok/skills`，但 **install --apply 已用绝对路径写好**，优先用 install。

## 对话示例

- Ask Claude to plan this feature  
- Ask Codex to review current changes  
- Ask Antigravity to investigate without editing  
