---
name: {{TARGET}}-result-handling
description: Use when checking AgentBridge setup, job status, results, or cancellation for {{TARGET_LABEL}} work started from {{HOST_LABEL}}.
---

# {{TARGET_LABEL}} Result Handling (AgentBridge)

Setup, status, result, and cancel for delegated **{{TARGET_LABEL}}** jobs.

## Setup / doctor

Only when installing, user asks to check setup, or a command reports missing binary / auth:

```bash
"{{WRAPPER}}" {{TARGET}} setup --json
agent-bridge doctor --host {{HOST}} --json
```

Do not run setup before every delegation.

## Job lifecycle

Jobs return a `jobId` (UUID). Lookup does **not** require host:

```bash
agent-bridge status "$JOB_ID" --json
agent-bridge result "$JOB_ID" --json
agent-bridge cancel "$JOB_ID" --json
```

A running job may have empty stdout for a while — keep polling unless the user set a time budget or the job is terminal.

## Notes

- Wrapper path is created by `agent-bridge install --host {{HOST}} --apply`.
- Users should not need to export environment variables for normal use.
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "$JOB_ID" --full` 按需取回，不要把超长输出整段复制进对话。
