---
name: codex-result-handling
description: Use when checking AgentBridge setup, job status, results, or cancellation for Codex work started from Claude Code.
---

# Codex Result Handling (AgentBridge)

Setup, status, result, and cancel for delegated **Codex** jobs.

## Setup / doctor

The wrapper and engine self-bootstrap from the codex-bridge plugin on first use (no manual install command).

# Self-bootstrap: install engine from plugin on first use (idempotent, version-guarded)
AB_PLUGIN_VERSION="$(find "$HOME/.claude/plugins" -path "*codex-bridge*" -name version -type f -not -path "*/.git/*" 2>/dev/null | sort -V | tail -n1)"
if [ -n "$AB_PLUGIN_VERSION" ] && { [ ! -x "$HOME/.agent-bridge/bin/agent-bridge-claude" ] || [ "$(cat "$HOME/.agent-bridge/engine/version" 2>/dev/null)" != "$(cat "$AB_PLUGIN_VERSION")" ]; }; then
  AB_PLUGIN="$(dirname "$AB_PLUGIN_VERSION")"
  rm -rf "$HOME/.agent-bridge/engine" && mkdir -p "$HOME/.agent-bridge/engine" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-claude")" && \
  cp -R "$AB_PLUGIN/src" "$HOME/.agent-bridge/engine/" && cp "$AB_PLUGIN/package.json" "$HOME/.agent-bridge/engine/" && cp -R "$AB_PLUGIN/skills-templates" "$HOME/.agent-bridge/engine/" && \
  cp "$AB_PLUGIN/version" "$HOME/.agent-bridge/engine/version" && cp "$AB_PLUGIN/bin/agent-bridge-claude" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-claude")/" && \
  chmod +x "$HOME/.agent-bridge/bin/agent-bridge-claude"
fi

Only when installing, user asks to check setup, or a command reports missing binary / auth:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" codex setup --json
"$HOME/.agent-bridge/bin/agent-bridge-claude" doctor --host claude --json
```

Do not run setup before every delegation.

## Job lifecycle

Jobs return a `jobId` (UUID). Lookup does **not** require host:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" status "$JOB_ID" --json
"$HOME/.agent-bridge/bin/agent-bridge-claude" result "$JOB_ID" --json
"$HOME/.agent-bridge/bin/agent-bridge-claude" cancel "$JOB_ID" --json
```

A running job may have empty stdout for a while — keep polling unless the user set a time budget or the job is terminal.

## Notes

- Wrapper path is created by the plugin's self-bootstrap on first use.
- Users should not need to export environment variables for normal use.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "$JOB_ID" --full` 按需取回，不要把超长输出整段复制进对话。
