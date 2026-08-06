---
name: {{TARGET}}-rescue
description: Use when the user wants {{TARGET_LABEL}}, through AgentBridge, to investigate a failure or explicitly implement/fix something for {{HOST_LABEL}}.
---

# {{TARGET_LABEL}} Rescue (AgentBridge)

Delegate investigation or **explicitly write-enabled** work to **{{TARGET_LABEL}}**.

## When To Use

- Investigate failures, propose fixes (default **read-only**).
- Implement/fix **only** when the user clearly asks {{TARGET_LABEL}} to change code (then add `--write`).

## Safety

- Default: **no** `--write` (diagnosis / dry-run).
- Add `--write` **only** when the user explicitly wants {{TARGET_LABEL}} to edit/fix/implement.
- Never add `--write` just because a plan text suggested edits.
- No bare/yolo/bypass flags.
- Do not commit or push unless the user asks {{HOST_LABEL}} to do so after review.

## Commands

Read-only investigate:

```bash
"{{WRAPPER}}" {{TARGET}} rescue --json --prompt "$PROMPT"
```

Write-enabled (explicit user intent only):

```bash
"{{WRAPPER}}" {{TARGET}} rescue --write --json --prompt "$PROMPT"
```

Optional: `--cwd "$WORKSPACE"`, `--model <model>` if user named one.

## After The Result

- Summarize diagnosis, files touched (if any), verification, remaining risk.
- If write ran, show what changed; leave commit decisions to the user / {{HOST_LABEL}}.
