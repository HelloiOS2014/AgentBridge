---
name: grok-review
description: Use when the user wants Grok Build, through AgentBridge, to review current changes, a branch diff, or adversarially challenge a design for Claude Code.
---

# Grok Build Review (AgentBridge)

Delegate **read-only code/design review** to local **Grok Build**.

## When To Use

- Normal review of working tree / branch changes.
- Adversarial review when the user wants challenge, alternatives, failure modes (pass focus text in the prompt; use `adversarial-review`).

## When Not To Use

- User only wants Claude Code local review.
- User asked for fixes/edits (use `grok-rescue` with explicit write intent instead).

## Safety

- Review is **read-only**. Never pass `--write`.
- No bare/yolo/bypass flags.
- Do not auto-fix findings.

## Commands

Normal review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" grok review --json
```

Adversarial / focused review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-claude" grok adversarial-review --json --prompt "$FOCUS"
```

Optional: `--cwd "$WORKSPACE"`.

## After The Result

- Present findings first; keep file references and residual risk.
- Do not start implementing fixes unless the user explicitly requests it.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
