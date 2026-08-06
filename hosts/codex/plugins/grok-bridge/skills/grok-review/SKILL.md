---
name: grok-review
description: Use when the user wants Grok Build, through AgentBridge, to review current changes, a branch diff, or adversarially challenge a design for Codex.
---

# Grok Build Review (AgentBridge)

Delegate **read-only code/design review** to local **Grok Build**.

## When To Use

- Normal review of working tree / branch changes.
- Adversarial review when the user wants challenge, alternatives, failure modes (pass focus text in the prompt; use `adversarial-review`).

## When Not To Use

- User only wants Codex local review.
- User asked for fixes/edits (use `grok-rescue` with explicit write intent instead).

## Safety

- Review is **read-only**. Never pass `--write`.
- No bare/yolo/bypass flags.
- Do not auto-fix findings.

## Commands

The wrapper and engine self-bootstrap from the grok-bridge plugin on first use (no manual install command).

# Self-bootstrap: install engine from plugin on first use (idempotent, version-guarded)
AB_PLUGIN_VERSION="$(find "$HOME/.codex" -path "*grok-bridge*" -name version -type f -not -path "*/.git/*" 2>/dev/null | head -n1)"
if [ -n "$AB_PLUGIN_VERSION" ] && { [ ! -x "$HOME/.agent-bridge/bin/agent-bridge-codex" ] || [ "$(cat "$HOME/.agent-bridge/engine/version" 2>/dev/null)" != "$(cat "$AB_PLUGIN_VERSION")" ]; }; then
  AB_PLUGIN="$(dirname "$AB_PLUGIN_VERSION")"
  rm -rf "$HOME/.agent-bridge/engine" && mkdir -p "$HOME/.agent-bridge/engine" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-codex")" && \
  cp -R "$AB_PLUGIN/src" "$HOME/.agent-bridge/engine/" && cp "$AB_PLUGIN/package.json" "$HOME/.agent-bridge/engine/" && cp -R "$AB_PLUGIN/skills-templates" "$HOME/.agent-bridge/engine/" && \
  cp "$AB_PLUGIN/version" "$HOME/.agent-bridge/engine/version" && cp "$AB_PLUGIN/bin/agent-bridge-codex" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-codex")/" && \
  chmod +x "$HOME/.agent-bridge/bin/agent-bridge-codex"
fi

Normal review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-codex" grok review --json
```

Adversarial / focused review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-codex" grok adversarial-review --json --prompt "$FOCUS"
```

Optional: `--cwd "$WORKSPACE"`.
If the user gave a file / image / design mock to review, pass it with `--attach "$FILE"` (absolute path, repeatable).

## After The Result

- Present findings first; keep file references and residual risk.
- Do not start implementing fixes unless the user explicitly requests it.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
