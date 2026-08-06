---
name: {{TARGET}}-plan
description: Use when the user wants {{TARGET_LABEL}}, through AgentBridge, to produce architecture plans, specs, sequencing, risk analysis, or implementation strategy for {{HOST_LABEL}}.
---

# {{TARGET_LABEL}} Plan (AgentBridge)

Delegate **read-only planning** to local **{{TARGET_LABEL}}** via AgentBridge.

## When To Use

- User asks {{HOST_LABEL}} to have {{TARGET_LABEL}} plan architecture, design, rollout, risks, or sequencing.
- Prefer background only when the host tool supports it and the plan is large; default foreground.

## When Not To Use

- Trivial tasks {{HOST_LABEL}} can do alone.
- User forbade delegation or named a different agent.
- Do not send secrets, tokens, or private keys in the prompt.

## Safety

- Planning is **read-only**. Never pass `--write`.
- Do **not** use bare/minimal/yolo/bypass flags.
- Do **not** auto-apply the plan, commit, or push.
- Do not re-run `setup` before every call unless a command fails with not-ready / missing binary.

## How To Invoke

Use the host wrapper (created by `agent-bridge install --host {{HOST}} --apply`). Prefer the absolute path below; do not require the user to export env vars.

```bash
"{{WRAPPER}}" {{TARGET}} plan --json --prompt "$PROMPT"
```

- Set `$PROMPT` to the user's planning request (and any bounded context they provided).
- Optional: `--cwd "$WORKSPACE"` if the workspace is not the current directory.
- Optional: `--model <model>` only if the user named a model.

## After The Result

- Return the JSON `rendered` / `summary` to the user.
- Preserve assumptions, risks, sequencing, and verification steps.
- Do **not** implement the plan unless the user explicitly asks {{HOST_LABEL}} to implement (or explicitly asks write-enabled rescue on {{TARGET_LABEL}}).
- 优先呈现 `summary`；若 `storage.truncated=true` 需要全文，用 `agent-bridge result "<job-id>" --full` 按需取回，不要把超长输出整段复制进对话。
