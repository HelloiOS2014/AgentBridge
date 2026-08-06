# Grok Host surface

**Allowed targets (no self):** `claude`, `codex`, `antigravity`.

Layout:

```text
hosts/grok/skills/                 # 平铺 skill（<target>-<kind>/SKILL.md）
hosts/grok/plugins/<target>-bridge # 插件引擎 payload（src/ + bin/agent-bridge-grok + version + package.json + skills-templates）
```

Marketplace install per Grok's plugin mechanism; the skill self-bootstrap copies the plugin engine payload to `~/.agent-bridge/engine` and `~/.agent-bridge/bin/agent-bridge-grok` on first use (idempotent, version-guarded).
