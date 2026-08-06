---
name: claude-rescue
description: Use when the user wants Claude Code, through AgentBridge, to investigate a failure or explicitly implement/fix something for Grok Build.
---

# Claude Code Rescue (AgentBridge)

Delegate investigation or **explicitly write-enabled** work to **Claude Code**.

## When To Use

- Investigate failures, propose fixes (default **read-only**).
- Implement/fix **only** when the user clearly asks Claude Code to change code (then add `--write`).

## Safety

- Default: **no** `--write` (diagnosis / dry-run).
- Add `--write` **only** when the user explicitly wants Claude Code to edit/fix/implement.
- Never add `--write` just because a plan text suggested edits.
- No bare/yolo/bypass flags.
- Do not commit or push unless the user asks Grok Build to do so after review.

## Commands

Read-only investigate:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-grok" claude rescue --json --prompt "$PROMPT"
```

Write-enabled (explicit user intent only):

```bash
"$HOME/.agent-bridge/bin/agent-bridge-grok" claude rescue --write --json --prompt "$PROMPT"
```

Optional: `--cwd "$WORKSPACE"`, `--model <model>` if user named one.

## After The Result

- Summarize diagnosis, files touched (if any), verification, remaining risk.
- If write ran, show what changed; leave commit decisions to the user / Grok Build.
