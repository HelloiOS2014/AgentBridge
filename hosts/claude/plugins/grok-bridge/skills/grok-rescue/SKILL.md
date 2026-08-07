---
name: grok-rescue
description: Use when the user wants Grok Build, through AgentBridge, to investigate a failure or explicitly implement/fix something for Claude Code.
---

# Grok Build Rescue (AgentBridge)

Delegate investigation or **explicitly write-enabled** work to **Grok Build**.

## When To Use

- Investigate failures, propose fixes (default **read-only**).
- Implement/fix **only** when the user clearly asks Grok Build to change code (then add `--write`).

## Safety

- Default: **no** `--write` (diagnosis / dry-run).
- Add `--write` **only** when the user explicitly wants Grok Build to edit/fix/implement.
- Never add `--write` just because a plan text suggested edits.
- No bare/yolo/bypass flags.
- Do not commit or push unless the user asks Claude Code to do so after review.

## Commands

The wrapper and engine self-bootstrap from the grok-bridge plugin on first use (no manual install command).

# Self-bootstrap: install engine from plugin on first use (idempotent, version-guarded)
AB_PLUGIN_VERSION="$(find "$HOME/.claude/plugins" -path "*grok-bridge*" -name version -type f -not -path "*/.git/*" 2>/dev/null | sort -V | tail -n1)"
if [ -n "$AB_PLUGIN_VERSION" ] && { [ ! -x "$HOME/.agent-bridge/bin/agent-bridge-claude" ] || [ "$(cat "$HOME/.agent-bridge/engine/version" 2>/dev/null)" != "$(cat "$AB_PLUGIN_VERSION")" ]; }; then
  AB_PLUGIN="$(dirname "$AB_PLUGIN_VERSION")"
  rm -rf "$HOME/.agent-bridge/engine" && mkdir -p "$HOME/.agent-bridge/engine" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-claude")" && \
  cp -R "$AB_PLUGIN/src" "$HOME/.agent-bridge/engine/" && cp "$AB_PLUGIN/package.json" "$HOME/.agent-bridge/engine/" && cp -R "$AB_PLUGIN/skills-templates" "$HOME/.agent-bridge/engine/" && \
  cp "$AB_PLUGIN/version" "$HOME/.agent-bridge/engine/version" && cp "$AB_PLUGIN/bin/agent-bridge-claude" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-claude")/" && \
  chmod +x "$HOME/.agent-bridge/bin/agent-bridge-claude"
fi

Read-only investigate:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" grok rescue --json --prompt "$PROMPT"
```

Write-enabled (explicit user intent only):

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" grok rescue --write --json --prompt "$PROMPT"
```

Optional: `--cwd "$WORKSPACE"`, `--model <model>` if user named one.
If the user gave a file / log / screenshot path to investigate, pass it with `--attach "$FILE"` (absolute path, repeatable).

## After The Result

- Summarize diagnosis, files touched (if any), verification, remaining risk.
- If write ran, show what changed; leave commit decisions to the user / Claude Code.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
- On `--write` rescue with attachments, the staged files stay in the workspace (`agent-bridge-attach-<n>-<name>`); report their paths in the result.
