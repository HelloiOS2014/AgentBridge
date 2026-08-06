---
name: grok-rescue
description: Use when the user wants Grok Build, through AgentBridge, to investigate a failure or explicitly implement/fix something for Codex.
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
- Do not commit or push unless the user asks Codex to do so after review.

## Commands

Read-only investigate:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-codex" grok rescue --json --prompt "$PROMPT"
```

Write-enabled (explicit user intent only):

```bash
"$HOME/.agent-bridge/bin/agent-bridge-codex" grok rescue --write --json --prompt "$PROMPT"
```

Optional: `--cwd "$WORKSPACE"`, `--model <model>` if user named one.

## After The Result

- Summarize diagnosis, files touched (if any), verification, remaining risk.
- If write ran, show what changed; leave commit decisions to the user / Codex.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
