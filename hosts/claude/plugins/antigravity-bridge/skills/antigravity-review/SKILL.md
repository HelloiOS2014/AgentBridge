---
name: antigravity-review
description: Use when the user wants Antigravity, through AgentBridge, to review current changes, a branch diff, or adversarially challenge a design for Claude Code.
---

# Antigravity Review (AgentBridge)

Delegate **read-only code/design review** to local **Antigravity**.

## When To Use

- Normal review of working tree / branch changes.
- Adversarial review when the user wants challenge, alternatives, failure modes (pass focus text in the prompt; use `adversarial-review`).

## When Not To Use

- User only wants Claude Code local review.
- User asked for fixes/edits (use `antigravity-rescue` with explicit write intent instead).

## Safety

- Review is **read-only**. Never pass `--write`.
- No bare/yolo/bypass flags.
- Do not auto-fix findings.

## Commands

The wrapper and engine self-bootstrap from the antigravity-bridge plugin on first use (no manual install command).

# Self-bootstrap: install engine from plugin on first use (idempotent, version-guarded)
AB_PLUGIN_VERSION="$(find "$HOME/.claude/plugins" -path "*antigravity-bridge*" -name version -type f -not -path "*/.git/*" 2>/dev/null | head -n1)"
if [ -n "$AB_PLUGIN_VERSION" ] && { [ ! -x "$HOME/.agent-bridge/bin/agent-bridge-claude" ] || [ "$(cat "$HOME/.agent-bridge/engine/version" 2>/dev/null)" != "$(cat "$AB_PLUGIN_VERSION")" ]; }; then
  AB_PLUGIN="$(dirname "$AB_PLUGIN_VERSION")"
  rm -rf "$HOME/.agent-bridge/engine" && mkdir -p "$HOME/.agent-bridge/engine" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-claude")" && \
  cp -R "$AB_PLUGIN/src" "$HOME/.agent-bridge/engine/" && cp "$AB_PLUGIN/package.json" "$HOME/.agent-bridge/engine/" && cp -R "$AB_PLUGIN/skills-templates" "$HOME/.agent-bridge/engine/" && \
  cp "$AB_PLUGIN/version" "$HOME/.agent-bridge/engine/version" && cp "$AB_PLUGIN/bin/agent-bridge-claude" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-claude")/" && \
  chmod +x "$HOME/.agent-bridge/bin/agent-bridge-claude"
fi

Normal review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" antigravity review --json
```

Adversarial / focused review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" antigravity adversarial-review --json --prompt "$FOCUS"
```

Optional: `--cwd "$WORKSPACE"`.
If the user gave a file / image / design mock to review, pass it with `--attach "$FILE"` (absolute path, repeatable).

## After The Result

- Present findings first; keep file references and residual risk.
- Do not start implementing fixes unless the user explicitly requests it.
