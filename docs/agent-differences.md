# 各 Agent 差异矩阵（调研明细）

**状态：** 调研附录；**规范以 `docs/design.md` v2 §9 为准**。  
**原则：** 不靠臆测。能力变更先改 design §9 与测试，再改本文。

实测记录可追加到各 Target 小节末尾。

---

## 0. 资料来源

| Agent | 来源 |
|-------|------|
| **Claude Code** | `claude --help`；现网 codex-agent-bridge / `规划插件` `claude.mjs` `foreground.mjs` |
| **Codex** | `codex exec --help`、`codex exec review --help`；[codex-plugin-cc](https://github.com/openai/codex-plugin-cc)（见 `docs/reference-codex-plugin-cc.md`） |
| **Grok Build** | `~/.grok/docs/user-guide/` 14/18/19/22/07 |
| **Antigravity** | `agy --help`；现网 `agy.mjs` `workspace-isolation.mjs` `foreground.mjs` |

---

## 1. 与 design v2 的关系

| 项 | 位置 |
|----|------|
| 黄金 argv / Kind 映射 | **design §9** |
| 只读分级 / WriteProbe | **design §8.5** |
| Codex L1/L2/L3 | **design §9.2** |
| Host lock | **design §3** |
| 本文件 | 长表、出处摘录、实测笔记 |

design v2 已吸收：Claude/Agy 现网路径、Grok MCP 陷阱、Codex approval never 官方实践、isolation+probe。

---

## 2. Headless 入口与输出

| | Claude | Codex | Grok | Antigravity |
|--|--------|-------|------|-------------|
| 入口 | `claude -p` | L1 `codex exec`；L2 `exec review`；L3 app-server | `grok -p` | `agy --print` |
| 结构化输出 | `--output-format json` | `--json` JSONL；`-o` last-message；app-server RPC | `--output-format json` | best-effort JSON / text |
| Prompt | stdin（现网） | argv/stdin | `-p` / file | `-- <prompt>` |
| 会话恢复 | continue/resume | exec resume / thread resume | continue/resume | continue/conversation |
| 后台 | 可选原生 `--bg`；Core job | Core job | Core job | Core job |
| 超时 | 外层 | 外层 | 外层 | **默认 print-timeout 5m** |

---

## 3. 现网已固化（Claude）

| Kind | tools | permissionMode |
|------|-------|----------------|
| plan | Read,Glob,Grep | dontAsk |
| review | none `""` | — |
| rescue 读 | read | — |
| rescue 写 | + Edit,MultiEdit,Write | — |

禁止：bypassPermissions、dangerously-skip-permissions 等。

---

## 4. 现网已固化（Antigravity）

| Kind | CLI | 额外 |
|------|-----|------|
| 只读类 | `--print --sandbox` | isolation 快照 + touchedFiles fail |
| write | `--print` 无 sandbox | 禁只读 resume |

---

## 5. Codex 官方插件要点（不照搬产品默认）

| 点 | codex-plugin-cc | AgentBridge |
|----|-----------------|-------------|
| 传输 | app-server 主路径 | L1/L2 先，L3 分期 |
| review sandbox | read-only | 同 |
| approval | never | 同语义（exec 用 `-c` 实测） |
| rescue 默认写 | **是** | **否（默认只读）** |
| transfer / review gate | 有 | V1 不做 |

---

## 6. Grok 文档要点

- `--tools` 后 **MCP meta-tools 可能仍在** → 只读必须额外 deny/禁 MCP  
- `--sandbox read-only` 适合 review  
- `--disallowed-tools Agent` 防子 agent  
- Plan mode ≠ 简单 headless flag  
- 自动化文档倾向 always-approve + deny；**write 路径再评估，plan 优先 dontAsk + sandbox**

---

## 7. 实测笔记（实现时填写）

### Claude

- [x] plan dontAsk 零交互（现网）  
- [x] **禁止** `--bare` / 精简模式（产品铁律，design §3.4）  

### Codex

- [ ] L1 `exec` + read-only + approval 覆盖键名  
- [ ] L2 `exec review --uncommitted`  
- [ ] 无 dangerously-bypass 是否挂起  

### Grok

- [ ] plan 黄金 argv 零交互  
- [ ] MCP 禁用后 WriteProbe  
- [ ] `MCPTool(*)` deny 语法  

### Antigravity

- [x] isolation + probe（现网）  
- [ ] print-timeout 与长任务 background  

### Antigravity (agy) 已知事实（2026-08 实测 + 官方文档）

- `--model` 在 print 模式会吞掉用户 prompt（实测 5 种取值形式均复现）——适配器永不传 `--model`；模型跟随 `~/.gemini/antigravity-cli/settings.json` 的 `model` 字段（ID 与显示名均接受）。
- headless 规范：`-p` + `--output-format json`（信封含 response/status/error/usage）；`--mode plan` 为官方只读调查模式；`--print-timeout` 建议 15m。
- shell 命令默认 Ask、headless 下 soft-deny（exit 0 空输出）——需 `permissions.allow` 规则（如 `command(ls)`）预放行；或 `toolPermission: proceed-in-sandbox` + `enableTerminalSandbox: on` 走 OS 容器自动运行。
- `--sandbox` 是终端命令 OS 容器（macOS sandbox-exec），不是执行模式。
- 产品谱系：Antigravity CLI (agy, Go) / Antigravity IDE (VS Code fork) / Antigravity SDK (Python) 共享 jetski 运行时；Gemini CLI 已于 2026-06 停服。

---

**附录结束。规范以 design.md v2 为准。**
