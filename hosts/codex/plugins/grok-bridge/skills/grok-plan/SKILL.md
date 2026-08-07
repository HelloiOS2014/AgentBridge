---
name: grok-plan
description: Use when the user wants Grok Build, through AgentBridge, to produce architecture plans, specs, sequencing, risk analysis, or implementation strategy for Codex.
---

# Grok Build Plan (AgentBridge)

Delegate **read-only planning** to local **Grok Build** via AgentBridge.

## When To Use

- User asks Codex to have Grok Build plan architecture, design, rollout, risks, or sequencing.
- Prefer background only when the host tool supports it and the plan is large; default foreground.

## When Not To Use

- Trivial tasks Codex can do alone.
- User forbade delegation or named a different agent.
- Do not send secrets, tokens, or private keys in the prompt.

## Safety

- Planning is **read-only**. Never pass `--write`.
- Do **not** use bare/minimal/yolo/bypass flags.
- Do **not** auto-apply the plan, commit, or push.
- Do not re-run `setup` before every call unless a command fails with not-ready / missing binary.

## How To Invoke

Use the host wrapper (installed by the grok-bridge plugin's self-bootstrap on first use; no manual install command needed). Prefer the absolute path below; do not require the user to export env vars.

# Self-bootstrap: install engine from plugin on first use (idempotent, version-guarded)
AB_PLUGIN_VERSION="$(find "$HOME/.codex" -path "*grok-bridge*" -name version -type f -not -path "*/.git/*" 2>/dev/null | sort -V | tail -n1)"
if [ -n "$AB_PLUGIN_VERSION" ] && { [ ! -x "$HOME/.agent-bridge/bin/agent-bridge-codex" ] || [ "$(cat "$HOME/.agent-bridge/engine/version" 2>/dev/null)" != "$(cat "$AB_PLUGIN_VERSION")" ]; }; then
  AB_PLUGIN="$(dirname "$AB_PLUGIN_VERSION")"
  rm -rf "$HOME/.agent-bridge/engine" && mkdir -p "$HOME/.agent-bridge/engine" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-codex")" && \
  cp -R "$AB_PLUGIN/src" "$HOME/.agent-bridge/engine/" && cp "$AB_PLUGIN/package.json" "$HOME/.agent-bridge/engine/" && cp -R "$AB_PLUGIN/skills-templates" "$HOME/.agent-bridge/engine/" && \
  cp "$AB_PLUGIN/version" "$HOME/.agent-bridge/engine/version" && cp "$AB_PLUGIN/bin/agent-bridge-codex" "$(dirname "$HOME/.agent-bridge/bin/agent-bridge-codex")/" && \
  chmod +x "$HOME/.agent-bridge/bin/agent-bridge-codex"
fi

```bash
"$HOME/.agent-bridge/bin/agent-bridge-codex" grok plan --json --prompt "$PROMPT"
```

- Set `$PROMPT` to the user's planning request (and any bounded context they provided).
- Optional: `--cwd "$WORKSPACE"` if the workspace is not the current directory.
- Optional: `--model <model>` only if the user named a model.
- If the user gave a file / image / screenshot path to analyze, pass it with `--attach "$FILE"` (absolute path, repeatable). The file is staged into the delegated workspace and the path in the prompt is rewritten to the staged location.

## After The Result

- Return the JSON `rendered` / `summary` to the user.
- Preserve assumptions, risks, sequencing, and verification steps.
- Do **not** implement the plan unless the user explicitly asks Codex to implement (or explicitly asks write-enabled rescue on Grok Build).
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
