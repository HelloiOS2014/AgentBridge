# Grok Host surface (Phase 0)

Skills/plugins for Grok Build will live here (or under Grok’s documented plugin paths).

**Allowed targets (no self):** `claude`, `codex`, `antigravity`.

Install via:

```bash
agent-bridge install --host grok --targets claude,codex --apply
```

Marketplace layout will follow Grok conventions in Phase 4; Phase 0 only reserves this tree and enforces no-self in `check-manifest`.
