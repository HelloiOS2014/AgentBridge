---
name: antigravity-review
description: Use when the user wants Antigravity, through AgentBridge, to review current changes, a branch diff, or adversarially challenge a design for Grok Build.
---

# Antigravity Review (AgentBridge)

Delegate **read-only code/design review** to local **Antigravity**.

## When To Use

- Normal review of working tree / branch changes.
- Adversarial review when the user wants challenge, alternatives, failure modes (pass focus text in the prompt; use `adversarial-review`).

## When Not To Use

- User only wants Grok Build local review.
- User asked for fixes/edits (use `antigravity-rescue` with explicit write intent instead).

## Safety

- Review is **read-only**. Never pass `--write`.
- No bare/yolo/bypass flags.
- Do not auto-fix findings.

## Commands

Normal review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-grok" antigravity review --json
```

Adversarial / focused review:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-grok" antigravity adversarial-review --json --prompt "$FOCUS"
```

Optional: `--cwd "$WORKSPACE"`.

## After The Result

- Present findings first; keep file references and residual risk.
- Do not start implementing fixes unless the user explicitly requests it.
