---
name: claude-review
description: Use when the user wants Claude Code, through AgentBridge, to review current changes, a branch diff, or adversarially challenge a design for Grok Build.
---

# Claude Code Review (AgentBridge)

Delegate **read-only code/design review** to local **Claude Code**.

## When To Use

- Normal review of working tree / branch changes.
- Adversarial review when the user wants challenge, alternatives, failure modes (pass focus text in the prompt; use `adversarial-review`).

## When Not To Use

- User only wants Grok Build local review.
- User asked for fixes/edits (use `claude-rescue` with explicit write intent instead).

## Safety

- Review is **read-only**. Never pass `--write`.
- No bare/yolo/bypass flags.
- Do not auto-fix findings.

## Commands

Normal review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-grok" claude review --json
```

Adversarial / focused review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-grok" claude adversarial-review --json --prompt "$FOCUS"
```

Optional: `--cwd "$WORKSPACE"`.

## After The Result

- Present findings first; keep file references and residual risk.
- Do not start implementing fixes unless the user explicitly requests it.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
