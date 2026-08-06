---
name: {{TARGET}}-result-handling
description: Use when checking AgentBridge setup, job status, results, or cancellation for {{TARGET_LABEL}} work started from {{HOST_LABEL}}.
---

# {{TARGET_LABEL}} Result Handling (AgentBridge)

Setup, status, result, and cancel for delegated **{{TARGET_LABEL}}** jobs.

## Setup / doctor

The wrapper and engine self-bootstrap from the {{TARGET}}-bridge plugin on first use (no manual install command).

{{BOOTSTRAP}}

Only when installing, user asks to check setup, or a command reports missing binary / auth:

```bash
"{{WRAPPER}}" {{TARGET}} setup --json
"{{WRAPPER}}" doctor --host {{HOST}} --json
```

Do not run setup before every delegation.

## Job lifecycle

Jobs return a `jobId` (UUID). Lookup does **not** require host:

```bash
"{{WRAPPER}}" status "$JOB_ID" --json
"{{WRAPPER}}" result "$JOB_ID" --json
"{{WRAPPER}}" cancel "$JOB_ID" --json
```

A running job may have empty stdout for a while — keep polling unless the user set a time budget or the job is terminal.

## Notes

- Wrapper path is created by the plugin's self-bootstrap on first use.
- Users should not need to export environment variables for normal use.
