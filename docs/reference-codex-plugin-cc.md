# 参考分析：openai/codex-plugin-cc

**仓库：** https://github.com/openai/codex-plugin-cc  
**定位（官方）：** *Use Codex from Claude Code to review code or delegate tasks.*  
**版本抽样：** marketplace `1.0.6`（以仓库当时内容为准）  
**许可：** Apache-2.0  

> **使用原则（用户约定）：仅作参考，不可整仓照搬。**  
> 它解决的是 **单向**「Claude Code Host → Codex Target」，且深度绑定 OpenAI Codex **app-server** 协议。  
> AgentBridge 要做 **多 Host × 多 Target**，默认安全姿态与发行面规则也不同。

---

## 1. 它是什么 / 不是什么

| 是 | 不是 |
|----|------|
| Claude Code **插件**（`.claude-plugin` marketplace） | 通用多 agent 总线 |
| Host=**Claude**，Target=**仅 Codex** | Codex 调 Claude（那是 codex-agent-bridge 方向） |
| Companion CLI + skills/commands/subagent + hooks | 纯 MCP 方案 |
| 生产级 **Codex app-server** 集成（JSON-RPC + broker） | 简单的 `codex exec` 包装器 |

与本仓库关系：

```text
codex-plugin-cc:     Claude  ──委派──► Codex
codex-agent-bridge:  Codex   ──委派──► Claude / Antigravity
AgentBridge:         {Codex|Claude|Grok} ──委派──► {非 self 的 targets}
```

---

## 2. 仓库结构（值得对齐的「形状」）

```text
.claude-plugin/marketplace.json     # Claude Code 货架
plugins/codex/
  .claude-plugin/plugin.json
  agents/codex-rescue.md            # 薄 subagent：只 Bash 转发 companion
  commands/                         # 用户 slash：review, rescue, status...
  skills/                           # 内部 skill（部分 user-invocable: false）
  hooks/                            # SessionStart、Stop review gate 等
  scripts/codex-companion.mjs       # 统一入口
  scripts/lib/codex.mjs             # app-server 调用核心
  scripts/lib/app-server.mjs        # JSON-RPC client + broker
  scripts/lib/git.mjs / state / jobs...
  schemas/review-output.schema.json
  prompts/
tests/fake-codex-fixture.mjs
```

**可参考的形状：**

1. Host 侧 marketplace + **单 Target 一 plugin**  
2. **Companion CLI** 为唯一运行时入口，slash/subagent 不直接拼 Codex 命令  
3. `${CLAUDE_PLUGIN_ROOT}/scripts/...` 绝对插件根路径  
4. review / adversarial / rescue(task) / status / result / cancel / setup 命令面  
5. Node ESM + 内置 test + fake fixture  

这与 codex-agent-bridge、本方案 Core 分层 **同构**，说明业界已收敛到该模式。

---

## 3. Codex 调用方式（关键差异）

### 3.1 官方插件：**app-server，不是 `codex exec` 主路径**

`plugins/codex/scripts/lib/codex.mjs`：

- 依赖 `codex` + **`codex app-server`**（`getCodexAvailability` 检查 `app-server --help`）  
- 通过 `CodexAppServerClient` 发 JSON-RPC  
- 可选 **shared broker**（`CODEX_COMPANION_APP_SERVER_ENDPOINT`）复用同一 runtime  

线程默认参数（`buildThreadParams`）：

```js
approvalPolicy: options.approvalPolicy ?? "never",
sandbox: options.sandbox ?? "read-only",
serviceName: "claude_code_codex_plugin",
ephemeral: options.ephemeral ?? true
```

| 场景 | 协议能力 | 默认 sandbox |
|------|----------|--------------|
| Review | `review/start` + target | **强制 `read-only`** |
| Task / rescue | `thread/start` 或 resume + `turn/start` | 由 `--write` 等决定（见 companion） |
| Cancel | `turn/interrupt` | — |
| Transfer | `externalAgentConfig/import`（Claude jsonl → Codex thread） | — |

**对 AgentBridge 的含义：**

- 先前 design 写「`codex exec`」是 **可行降级路径**，但 **不是** OpenAI 官方 Claude 插件的主路径。  
- Headless 审批挂起问题：官方默认 **`approvalPolicy: "never"` + sandbox read-only**，这是文档化实践，应写入我们的 Codex adapter 规范（并实测）。  
- V1 若只做 `codex exec`，能力会弱于官方插件（无 native review thread、无 interrupt 粒度、无 transfer）。  
- 完整 app-server 集成成本高（类型生成 `codex app-server generate-ts`、broker、协议演进）—— **可参考，宜分阶段**。

### 3.2 建议的 AgentBridge Codex Target 分层

| 层级 | 内容 | 优先级 |
|------|------|--------|
| **L1** | `codex exec` + `-s read-only` / `workspace-write` + `-c approval_policy=...`（以实测为准） | 先可跑 |
| **L2** | `codex exec review` 子命令（CLI 已有） | review 对齐 |
| **L3** | app-server `review/start` / `turn/start`（对齐官方插件） | 质量/体验对齐官方 |

**禁止：** 为图省事默认 `--dangerously-bypass-approvals-and-sandbox`（官方插件也未走这条主路径）。

---

## 4. 产品表面（slash / subagent）

| 表面 | 作用 | AgentBridge 是否对标 |
|------|------|----------------------|
| `/codex:setup` | 安装探测、可选 review gate | doctor/setup ✅ 形状；gate 可选 |
| `/codex:review` | 只读 review，建议 background | ✅ |
| `/codex:adversarial-review` | 可带 focus 的挑战审查 | ✅ |
| `/codex:rescue` → subagent `codex-rescue` | 转发 `task` | ✅ 语义；**默认写权限见下** |
| `/codex:transfer` | Claude session → Codex resume | ❌ 第一期非目标（可二期） |
| `/codex:status/result/cancel` | job 生命周期 | ✅ |
| Stop **review gate** hook | Claude 将停时强制 Codex 再审 | ❌ 默认不做（官方也警告烧额度） |

Subagent 设计亮点（可参考 **纪律**，不抄默认写）：

- **薄转发器**：只允许一次 Bash → companion；禁止自己读仓解题  
- 用 skill 约束「只 forward，不 orchestrate」  
- 模型/effort 默认不传，用户显式才加  

---

## 5. 与我们安全默认的 **刻意不同**（不可照搬）

| 点 | codex-plugin-cc | AgentBridge / codex-agent-bridge |
|----|-----------------|----------------------------------|
| rescue 默认写 | **默认加 `--write`**，除非用户只要只读 | **默认只读**，显式 `--write` 才写 |
| self | 不适用（Claude≠Codex） | Host 禁 self |
| 多 Target | 仅 Codex | 四 Target 矩阵 |
| review gate | 可选 Stop hook | 默认不做 |
| 会话 transfer | 一等能力 | 非 V1 |
| 服务归因 | `serviceName: claude_code_codex_plugin` | 需自有 serviceName（若走 app-server） |

**必须坚持我们的默认只读 rescue**——官方插件面向「交给 Codex 干活」的产品叙事；我们是 **多 agent 对照/委派桥**，写权限更敏感。

---

## 6. 可借鉴清单（推荐吸收）

1. **Companion 统一入口** + Host 薄命令/skill/subagent  
2. **插件根 env**（`CLAUDE_PLUGIN_ROOT`）调用，不依赖用户 cwd 里的脚本  
3. **review 只读硬编码 sandbox**（app-server 层 `sandbox: "read-only"`）  
4. **`approvalPolicy: "never"`** 作为非交互委派默认（配合 sandbox，而非 dangerous bypass）  
5. **job：background / wait / status / result / cancel** + 可 resume thread  
6. **native review API** 优于纯 dump diff 喂模型（L3）  
7. **setup 可探测 auth + app-server 可用性**  
8. **测试用 fake fixture**，不依赖真 LLM  
9. Claude Host 侧：**slash command 负责 UX（是否 background）**，companion 负责执行  
10. 模型别名映射（如 spark → 具体 model id）——可按 Target 扩展  

---

## 7. 明确不要照搬清单

1. **整仓协议栈与 broker** 一上来全抄（维护成本、版本耦合）  
2. **rescue 默认 --write**  
3. **Stop review gate** 作为默认推荐  
4. **仅服务 Claude→Codex** 的 marketplace 命名/叙事（我们要多 Host 发行面）  
5. OpenAI 专用 prompting skill 全家桶（gpt-5-4-prompting）——可学「写 prompt 的纪律」，不绑定其模型文档  
6. 假设所有用户有 ChatGPT/Codex 订阅话术作为唯一 auth 路径  
7. 把 **transfer** 当 V1 必做  

---

## 8. 对 AgentBridge 文档的更新点

| 文档 | 应补充 |
|------|--------|
| `docs/design.md` | Codex Target：app-server 为 L3；exec 为 L1；引用本文 |
| `docs/agent-differences.md` | Codex 行：官方实践 `approvalPolicy=never` + `sandbox=read-only`；review 用 `review/start` 或 `exec review` |
| `docs/design-review.md` | P0「Codex headless 审批」部分缓解证据：官方插件默认 never |
| Claude Host 发行面 | 布局可参考 `.claude-plugin/marketplace.json` + `plugins/<target>/`，但 **plugin 集合按矩阵排除 self** |

---

## 9. 与 codex-agent-bridge 对照

| | codex-plugin-cc | codex-agent-bridge |
|--|-----------------|-------------------|
| Host | Claude Code | Codex |
| Target | Codex | Claude / Antigravity |
| 调用 Target 方式 | **app-server RPC** | `claude -p` / `agy --print` |
| Host 打包 | `.claude-plugin` | `.agents/plugins` + `.codex-plugin` |
| Companion | 有 | 有 |
| 只读 review | 有 | 有 |
| 默认 rescue 写 | 默认写 | 默认只读 |

AgentBridge = **两边的 companion 模式 + 多矩阵 + 禁 self**，Codex 侧实现 **优先读官方插件学协议，再决定 L1/L3 投入**。

---

## 10. 结论

| 问题 | 结论 |
|------|------|
| 是否重要参考？ | **是**——尤其是 Claude Host 打包与 Codex 非交互默认（approval/sandbox/app-server） |
| 能否当通用桥模板整搬？ | **否**——单 Target、默认写、app-server 全家桶、无 self 矩阵 |
| 对「差异处理」的帮助？ | **直接补齐 Codex-as-Target 最关键缺口**：不要只写 `codex exec`，要写清官方真正怎么挂 Codex |

**一句话：**  
`codex-plugin-cc` 证明「Claude 调 Codex」的正确工程形态是 **companion + 插件表面 + app-server（approval never / sandbox 分档）**；我们取其 **形态与 Codex 运行时实践**，拒取其 **产品默认写权限与单向心智**，并在 AgentBridge 里扩展到多 Host/多 Target。
