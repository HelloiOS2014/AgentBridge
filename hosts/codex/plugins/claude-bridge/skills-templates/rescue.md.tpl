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

The wrapper and engine self-bootstrap from the {{TARGET}}-bridge plugin on first use (no manual install command).

{{BOOTSTRAP}}

Read-only investigate:

```bash
"{{WRAPPER}}" {{TARGET}} rescue --json --prompt "$PROMPT"
```

Write-enabled (explicit user intent only):

```bash
"{{WRAPPER}}" {{TARGET}} rescue --write --json --prompt "$PROMPT"
```

Optional: `--cwd "$WORKSPACE"`, `--model <model>` if user named one.
If the user gave a file / log / screenshot path to investigate, pass it with `--attach "$FILE"` (absolute path, repeatable).

For complex or long tasks (multi-file redesigns, long reports, large diffs): append `--output file` to the wrapper invocation (or instruct in `$PROMPT`) — the target will write full output to `agent-bridge-output/` in the workspace and reply with paths + summaries, keeping the conversation light. Simple tasks stay inline.

## After The Result

- Summarize diagnosis, files touched (if any), verification, remaining risk.
- If write ran, show what changed; leave commit decisions to the user / {{HOST_LABEL}}.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
- On `--write` rescue with attachments, the staged files stay in the workspace (`agent-bridge-attach-<n>-<name>`); report their paths in the result.
