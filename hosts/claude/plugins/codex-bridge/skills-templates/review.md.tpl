---
name: {{TARGET}}-review
description: Use when the user wants {{TARGET_LABEL}}, through AgentBridge, to review current changes, a branch diff, or adversarially challenge a design for {{HOST_LABEL}}.
---

# {{TARGET_LABEL}} Review (AgentBridge)

Delegate **read-only code/design review** to local **{{TARGET_LABEL}}**.

## When To Use

- Normal review of working tree / branch changes.
- Adversarial review when the user wants challenge, alternatives, failure modes (pass focus text in the prompt; use `adversarial-review`).

## When Not To Use

- User only wants {{HOST_LABEL}} local review.
- User asked for fixes/edits (use `{{TARGET}}-rescue` with explicit write intent instead).

## Safety

- Review is **read-only**. Never pass `--write`.
- No bare/yolo/bypass flags.
- Do not auto-fix findings.

## Commands

The wrapper and engine self-bootstrap from the {{TARGET}}-bridge plugin on first use (no manual install command).

{{BOOTSTRAP}}

Normal review:

```bash
"{{WRAPPER}}" {{TARGET}} review --json
```

Adversarial / focused review:

```bash
"{{WRAPPER}}" {{TARGET}} adversarial-review --json --prompt "$FOCUS"
```

Optional: `--cwd "$WORKSPACE"`.
If the user gave a file / image / design mock to review, pass it with `--attach "$FILE"` (absolute path, repeatable).

## After The Result

- Present findings first; keep file references and residual risk.
- Do not start implementing fixes unless the user explicitly requests it.
