---
name: claude-result-handling
description: Use when checking AgentBridge setup, job status, results, or cancellation for Claude Code work started from Grok Build.
---

# Claude Code Result Handling (AgentBridge)

Setup, status, result, and cancel for delegated **Claude Code** jobs.

## Setup / doctor

Only when installing, user asks to check setup, or a command reports missing binary / auth:

```bash
"$HOME/.agent-bridge/bin/agent-bridge-grok" claude setup --json
agent-bridge doctor --host grok --json
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

- Wrapper path is created by `agent-bridge install --host grok --apply`.
- Users should not need to export environment variables for normal use.
