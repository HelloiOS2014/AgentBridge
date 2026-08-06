# AgentBridge 设计方案 v2

**版本：** 2.0  
**日期：** 2026-08-06  
**状态：** 实现前规格（吸收 design-review P0/P1、agent-differences、codex-plugin-cc 参考）  
**仓库：** AgentBridge  

### 参考材料（只参考，不整搬）

| 材料 | 角色 |
|------|------|
| [HelloiOS2014/codex-agent-bridge](https://github.com/HelloiOS2014/codex-agent-bridge) | Codex Host → Claude/Agy；companion、只读默认、job（**现网真源**） |
| [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) | Claude Host → Codex；app-server、approval never（**见 `docs/reference-codex-plugin-cc.md`**） |
| 本机 CLI help / `~/.grok/docs/user-guide` | Target 能力真源 |
| `docs/agent-differences.md` | 差异调研明细（本 v2 已吸收规范部分） |
| `docs/design-review.md` | v1 审查记录（历史；以本文为准） |

---

## 0. 一句话

> **一套本机 CLI Core + 可插拔 Target Adapter + 按 Host 拆开的发行面。**  
> Host 只能桥接到「别人」；用户自选 Target；**host lock 防装错**；Runtime 拒 self/nested；  
> 各 Target 差异用 **黄金 argv + 只读分级 + 能力声明** 写死，不靠摘要猜 flag。

---

## 1. 背景与问题

### 1.1 现状

codex-agent-bridge 已验证：Skill + Companion CLI、按 Target 拆包、只读默认、job、危险 flag 黑名单。

局限：Host 锁死 Codex；Target 实现分叉；缺 Grok/Codex 作 Target；self 与多 Host 未系统化。

### 1.2 目标

| ID | 目标 |
|----|------|
| G1 | 4 Target：claude / codex / grok / antigravity |
| G2 | 3 Host：codex / claude / grok |
| G3 | 禁止 self-delegation（发行面 + install + **host lock Runtime**） |
| G4 | 调用方自选安装 Target |
| G5 | 统一命令语义与 JSON；Core 一份 |
| G6 | 继承 codex-agent-bridge 安全默认与 job（**rescue 默认只读**，不照搬 codex-plugin-cc 默认写） |
| G7 | **CLI-only（永久）**：项目**永远禁止 MCP** 作为接口（核心路径仅 CLI 命令） |
| G8 | 每 Target 有可测 headless 规范与只读分级 |

### 1.3 非目标（永久）

- agent 间实时总线 / 云端编排  
- Host 间 skills/MCP 配置同步  
- 自动 apply / commit / push  
- 同 Target 双开对照（仅测试 `ALLOW_SELF`）  
- Antigravity 作 Host  
- Claude↔Codex **session transfer**（codex-plugin-cc 有，V1 不做）  
- Stop review gate（官方也警告烧额度）  
- 一上来全量 Codex app-server broker（**L3 分期**）

---

## 2. 角色与矩阵

### 2.1 术语

| 术语 | 含义 |
|------|------|
| Host | 用户当前使用的 agent |
| Target | 被委派的本地 CLI agent |
| Bridge | 某 Host 上针对某 Target 的 plugin/skill 包装 |
| Core | `agent-bridge` CLI + job/state/safety |
| Adapter | 某 Target 的发现、argv、解析、只读策略 |
| 发行面 | 某 Host 的 marketplace/skills（用户可见可装） |
| Host lock | install 写入的不可由 skill 伪造的 host 身份 |
| Wrapper | 如 `agent-bridge-codex`，内置 locked host |

### 2.2 Host × Target（产品面）

| Host \ Target | claude | codex | grok | antigravity |
|---------------|:------:|:-----:|:----:|:-----------:|
| **codex**     | ✅     | ❌    | ✅   | ✅          |
| **claude**    | ❌     | ✅    | ✅   | ✅          |
| **grok**      | ✅     | ✅    | ❌   | ✅          |

```text
allowed_targets(host) = {claude, codex, grok, antigravity} \ {host}
```

规范 ID 仅允许小写枚举：`codex | claude | grok | antigravity`。

---

## 3. 禁止 self + Host 身份（v2 修订）

### 3.1 三层防御 + Host lock（吸收审查 P0-1）

```text
L1 发行面：hosts/<host>/ 永不包含 self-target plugin/skill
L2 安装器：targets ⊆ allowed(host)；含 self → 失败
L3 Runtime：lockedHost === target → exit 3
L0 包装：skills 只调用 host wrapper，不依赖可伪造的 AGENT_BRIDGE_HOST 单独放行
```

### 3.2 Host lock 机制（V1 必做）

**目的（务实）：** 防止 **装错发行面 / skill 写错 host** 导致「在 Codex 里又拉起 Codex」。  
**不是：** 防本机恶意伪造 wrapper——那种人自己电脑想套自己，不必当产品威胁。

`install --host <host>` 写入：

```text
~/.agent-bridge/
  config.json                 # 可选全局
  hosts/<host>.lock.json      # { "host": "codex", "installedAt": "...", "targets": [...] }
  bin/agent-bridge-<host>     # wrapper：强制 --host <host>，再 exec 主 CLI
```

规则：

1. 委派类命令（`plan|review|adversarial-review|rescue`）**必须**解析出 `lockedHost`：  
   - wrapper 硬编码 host，或 env `AGENT_BRIDGE_LOCKED_HOST`（由 wrapper 设置）。  
2. 裸 `AGENT_BRIDGE_HOST` 不足以单独授权；与 `LOCKED_HOST` 冲突 → 失败。  
3. 无 lock/host：**拒绝**委派类命令（exit 2）。  
4. 元命令例外：`setup` / `doctor` / `install` / `storage` / `cleanup` / `help` 可不要求 host。  
5. 调试：`AGENT_BRIDGE_ALLOW_UNSCOPED=1`；测试 self：`AGENT_BRIDGE_ALLOW_SELF=1`（不进用户主路径文档）。

### 3.3 Nested（吸收审查 P0-5，随 adapter 交付）

| 手段 | 要求 |
|------|------|
| Core spawn 子进程 | 设 `AGENT_BRIDGE_NESTED=1` |
| 再入 bridge | `NESTED=1` → exit 4（元命令亦拒，避免子会话装 bridge） |
| Skill 文案 | 被委派 agent 不得再调 agent-bridge |
| **Adapter 硬化（随该 Target 交付）** | 见 §9；**不得**靠精简模式（见 §3.4） |

残余风险：子 agent **直接**调对端 CLI 而不经 bridge —— V1 文档声明；用 NESTED、禁再委派 skill、工具限制等降低，**绝不**用 bare/minimal。

### 3.4 铁律：禁止精简 / bare / minimal 模式

**所有 Target、所有 Kind、包括嵌套与防环，一律不得启用「精简会话」类开关。**

| 禁止示例（不完整，同类皆禁） | |
|------------------------------|--|
| Claude | `--bare`、`--safe-mode`（以及等价「关掉正常登录/配置」的精简） |
| Codex | 以「精简掉正常 auth/配置」为目的的启动方式（正常 `--ignore-user-config` 等若用于隔离 bridge skills 须单独评审，**不得**作为「精简模式」砍登录） |
| Grok | 文档中的 minimal/bare 类会话若存在则禁；不得为防嵌套关掉正常认证 |
| Antigravity | 无则已；不得发明精简 flag |

**原因：** 精简模式常跳过 OAuth/keychain/正常配置，委派直接鉴权失败或行为与用户日常不一致。  
**防嵌套只靠：** `AGENT_BRIDGE_NESTED`、skill 禁止再调 bridge、tool/sandbox/isolation 等 **不破坏正常登录与默认运行时** 的手段。

---

## 4. 总体架构

```text
Host 发行面（无 self）+ 用户自选 Target plugins/skills
        │ 仅调用 agent-bridge-<host>
        ▼
agent-bridge / agent-bridge-<host>
  · 解析元命令 vs <target> <cmd>
  · lock / nested / self 门禁
        ▼
Core: args · jobs · state · git · storage · render · WriteProbe
        ▼
Adapter[target]: buildInvocation · parse · hardenEnv · capabilities
        ▼
claude | codex | grok | agy
```

原则：CLI-only；一 Target 一 Bridge 包；权限靠 profile/sandbox/isolation 而非仅靠 prompt；状态默认项目外；不自动 commit/push。

---

## 5. 分发模型（吸收审查 P0-4）— **已定案并实现（2026-08）**

### 5.1 选定：**marketplace 插件自足（打包引擎 + 首用自举 + 机器级唯一引擎）**

| 组件 | 安装方式 |
|------|----------|
| **货架** | 同一 monorepo 内按平台格式各出一份（Claude/Codex/Grok 的 marketplace 清单），**marketplace 是唯一入口** |
| **bridge 插件** | 每个 `<target>-bridge` 插件自包含：`src/`（引擎全量，零依赖自包含）+ `bin/agent-bridge-<host>`（静态 wrapper，写死 host lock）+ skills + `version` 标记 |
| **引擎落位** | skill 首次触发自举：从插件内复制引擎到 `~/.agent-bridge/engine/`、wrapper 到 `~/.agent-bridge/bin/agent-bridge-<host>`（幂等；插件版本升级自动覆盖更新）——**机器级唯一一份引擎，多 host 插件共用** |
| **统一安装器** | `agent-bridge install --host X --targets ...` 为**补充通道**（自动化 / 无 UI / 批量 targets），不替代 marketplace；npm / `npm link` **不再是前提** |

### 5.2 拒绝作为默认

- npm 全局安装作为 marketplace 前提（用户必须另跑安装命令）  
- `install --apply` 作为用户主流程（两步安装）  
- 只支持单一 Host 的 marketplace、其它 Host 只能手搓  

开发可用：`node <repo>/src/cli.mjs --host X …`（引擎即仓库 `src/` 本身）。

### 5.3 Skills 调用约定

```bash
# 正确：wrapper（host 已锁，自举生成，固定路径）
"$HOME/.agent-bridge/bin/agent-bridge-claude" codex plan --json --prompt "..."

# 自举段（skill 文案内嵌）：wrapper/引擎缺失或插件版本更新时，从插件内复制（幂等）
# 开发：
node "$AGENT_BRIDGE_DEV_ROOT/src/cli.mjs" --host codex claude plan ...
```

### 5.4 多 Host marketplace 兼容（**不是只放 Codex**）

各 Host 的「货架」格式不同，**一个仓库可以同时提供多套清单**，用户用哪个 Host 就 add/装哪套：

| Host | 清单位置（约定） | 用户怎么装 | 货架上有什么（无 self） |
|------|------------------|------------|-------------------------|
| **Codex** | 根 `.agents/plugins/marketplace.json`（Codex 习惯整仓 add） | `codex plugin marketplace add <repo>` → 按需 Add 插件 | claude / grok / antigravity bridges |
| **Claude** | 根或 `hosts/claude/` 下 `.claude-plugin/marketplace.json`（对齐官方插件形态） | `/plugin marketplace add ...` → install 对应插件 | codex / grok / antigravity bridges |
| **Grok** | Grok 支持的 plugins/skills 发行路径（`hosts/grok/` + 文档；随 Grok 惯例） | marketplace 或 `install --host grok` | claude / codex / antigravity bridges |

原则：

1. **兼容 = 多格式并列**，不是把所有人塞进 Codex 的 `.agents` 清单里（Claude/Grok 读不懂那一套也正常）。  
2. **每一套货架只含「别人」**（allowed_targets），CI 分别校验。  
3. **插件打包引擎（自举源），机器只落一份**：`src/` 全量进插件，skill 首用自举到 `~/.agent-bridge/engine/`；多 host 插件版本不一致时以「最新触发者」覆盖（自愈收敛）。`check-manifest` 强制插件内 `src/` 与根 `src/` 一致（文件清单 + sha256），防副本漂移。  
4. `agent-bridge install` 是 **统一补充路径**（自动化、无 UI、批量 targets），**不替代** 各平台原生 marketplace。  
5. README 分 Host 写安装；用户不会被要求「Claude 用户去 add Codex marketplace」。

---

## 6. 统一 CLI 契约

### 6.1 语法

```text
# 委派域
agent-bridge --host <host> <target> <command> [options]
agent-bridge-<host> <target> <command> [options]     # 等价，host 锁定
# options: --prompt <text> --cwd <dir> --model <model> --write
#          --attach <abs-path>（可重复，外部文件进快照/工作区）
#          --background（detached worker）/ --wait（轮询至完成，配合 --background）
#          --json

# 元命令（无 target）
agent-bridge doctor [--host <host>] [--json]
agent-bridge install --host <host> [--targets a,b] [--list] [--remove [target]] [--dry-run] [--apply]
agent-bridge status|result|cancel <job-id> [--json]
agent-bridge result <job-id> --full [--json]         # 跳过展示层截断
agent-bridge status --all [--host <host>] [--target <target>] [--json]
agent-bridge storage|cleanup [scope opts] [--json]
agent-bridge help
```

`target ∈ {claude,codex,grok,antigravity}`  
`command ∈ setup|plan|review|adversarial-review|rescue|status|result|cancel|storage|cleanup`

内部：`--worker <job-id>`（后台 worker 内部入口，skills 不调用；与 `--background` 互斥）。

### 6.2 门禁顺序

```text
1. 解析元命令 vs 委派
2. 若 NESTED=1 → exit 4
3. 委派类：解析 lockedHost；缺失 → exit 2
4. target ∉ allowed(lockedHost) 或 target === lockedHost → exit 3
5. dispatch
```

`status|result|cancel`：**按 job UUID 定位**（可维护索引或扫描 state 树），**不强制** host。  
`status --all` / 列表类：可选 `--host` / `--target` / `--cwd` 过滤。  
`storage|cleanup`：按范围参数操作（host/target/cwd），与「查单个 job」分开。

### 6.3 统一 JSON

成功/失败均可 `--json`。失败时 **stdout 仍为 JSON**（`status: failed` + `errorMessage` + `errorCode`），便于 skill 解析。

```json
{
  "status": "completed|failed|cancelled|running|queued",
  "errorCode": null,
  "target": "claude",
  "kind": "plan",
  "summary": "",
  "rendered": "",
  "rawOutput": "",
  "sessionId": null,
  "jobId": null,
  "write": false,
  "touchedFiles": [],
  "errorMessage": null,
  "capabilities": null,
  "metadata": {
    "host": "codex",
    "model": null,
    "cwd": "",
    "workspaceRoot": "",
    "readOnlyLevel": "tool-profile|sandbox|isolation+probe|best-effort",
    "codexTransport": "exec|exec-review|app-server|null",
    "storage": { "truncated": false, "truncatedFields": [], "omittedBytes": 0 }
  }
}
```

### 6.4 退出码

| Code | 含义 |
|------|------|
| 0 | 成功 |
| 1 | 通用失败 |
| 2 | 用法 / 缺 host lock |
| 3 | self-delegation 或 target 不在 allowed |
| 4 | nested refused |
| 5 | target CLI not ready |
| 6 | ~~storage quota~~（由 TTL 清理取代配额强制；保留未使用） |

### 6.5 环境变量

| 变量 | 用途 |
|------|------|
| `AGENT_BRIDGE_LOCKED_HOST` | 仅 wrapper 设置 |
| `AGENT_BRIDGE_NESTED` | Core 设为 1 |
| `AGENT_BRIDGE_ALLOW_SELF` | 测试 |
| `AGENT_BRIDGE_ALLOW_UNSCOPED` | 调试委派无 host |
| `AGENT_BRIDGE_STATE_DIR` | 状态根 |
| `AGENT_BRIDGE_<TARGET>_BIN` | 如 `AGENT_BRIDGE_CLAUDE_BIN` |
| `AGENT_BRIDGE_ENV_ALLOWLIST` | 逗号分隔，追加到目标 CLI env 白名单（见 §11.5） |
| 兼容旧名 | `CLAUDE_COMPANION_*` / `ANTIGRAVITY_COMPANION_*`（迁移期，新名优先；到期移除，见 §12） |

---

## 7. Adapter 接口（v2）

```ts
type TargetId = "claude" | "codex" | "grok" | "antigravity";
type Kind = "plan" | "review" | "adversarial-review" | "rescue";
type ReadOnlyLevel = "tool-profile" | "sandbox" | "isolation+probe" | "best-effort";

interface TargetCapabilities {
  plan: "native" | "emulated" | "degraded";
  review: "native" | "emulated" | "precollect";
  readOnlyGuarantee: ReadOnlyLevel;
  headlessZeroInteractive: boolean; // 该规范下是否承诺零交互
  transports?: string[];            // e.g. codex: exec, exec-review, app-server
}

interface AgentAdapter {
  id: TargetId;
  capabilities(): TargetCapabilities;
  resolveBin(env): string | null;
  discoverBinCandidates(env): string[];
  setup(ctx): Promise<SetupResult>;
  buildInvocation(req: {
    kind: Kind;
    write: boolean;
    prompt: string;
    model?: string;
    effort?: string;
    cwd: string;
    precollectedContext?: string;
    env: NodeJS.ProcessEnv;
  }): Invocation;
  hardenEnv(env, req): NodeJS.ProcessEnv;  // NESTED 已由 Core 合并；此处去 skills/MCP/临时 HOME 等
  parseResult(input): ParsedResult;
  postReadOnlyCheck?(cwd, beforeGitStatus): Promise<{ ok: boolean; touchedFiles: string[] }>;
}
```

Core 对 `plan|review|adversarial-review` 与只读 `rescue`：

1. 记录 git 指纹（若在 git 仓）  
2. 跑 adapter  
3. 若 `postReadOnlyCheck` 或通用 WriteProbe 发现工作区被改 → **fail**（Antigravity 现网逻辑升为通用策略可选）

---

## 8. Core 运行时

### 8.1 权限语义（产品）

| 命令 | 工作区写 | 说明 |
|------|----------|------|
| plan / review / adversarial-review | 否 | |
| rescue | 否 | 诊断 / dry-run |
| rescue `--write` | 是 | 仅用户明确 fix/implement；**skill 才加 flag** |
| 元命令 / status… | 否（可写 state） | |

**不得**根据 Target 输出的 plan 文本自动加 `--write`。

`rescue --write`（Antigravity 目标）在 **git worktree** 中执行：`git worktree add <tmp> -b agent-bridge-write-<ts>`（从当前仓库派生），目标 CLI 以 worktree 为 cwd 运行，主工作区不被污染。**产出语义：** 改动保留在 worktree/分支供审阅，结果报告 worktree 路径与改动文件；**不自动 commit/push、不自动清理 worktree**——合并/丢弃由用户决定。非 git 目录/无 git 时回退直接运行。不做跨 job 锁；skill 要求干净 git 或明确接受风险。

### 8.2 Review 目标

`scope`: `auto | working-tree | branch`；截断与 metadata 同 codex-agent-bridge 量级。

### 8.3 Job（**已实现，Phase 5**）

- `--background`：spawn detached worker（自成进程组），父进程写 running 记录（含 pid，唯一写者），立即返回 `{status: "running", jobId}`；worker 用内部 `--worker <job-id>` 跑委派并覆盖最终记录  
- `--wait`：配合 `--background` 轮询至非 running（500ms 间隔，默认 10min，`AGENT_BRIDGE_WAIT_TIMEOUT_MS`）；单独使用 → usage 错误  
- `cancel`：按 pid 杀进程组（`terminateProcessTree`），标记 cancelled 前复查仍 running（防竞态）；孤儿 running 记录由 TTL 清理兜底  
- `status` 轻量（job 状态/summary 等）；`result` 返回完整结构（展示层截断，`--full` 全文）  
- **截断**：展示层（cli.mjs emit/result 读取）按阈值截断 rendered(16KB)/rawOutput(64KB)，磁盘落盘全量；env `AGENT_BRIDGE_RENDER_LIMIT_KB` / `AGENT_BRIDGE_RAW_LIMIT_KB`  
- **TTL 清理**：`persistJob` 机会式 `pruneExpiredJobs`（默认 7 天，`AGENT_BRIDGE_JOB_TTL_DAYS`，≤0 禁用；跳过 running 记录）；QUOTA(exit 6) 由 TTL 取代，保持未使用（见 §6.4）  

### 8.4 状态布局（吸收 P1-4）

```text
$STATE_ROOT/
  <host>/
    <target>/
      <workspace-hash>/
        state.json
        jobs/<id>.json
        jobs/<id>.log
```

存储按 host/target 分桶（清理、统计方便）。  
**查找**可按 UUID 跨桶定位；列表默认可带 lock 时仅当前 host，或显式过滤。

### 8.5 只读保证分级（吸收 P0-3）

| Level | 含义 | 典型 Target |
|-------|------|-------------|
| `tool-profile` | CLI 工具白名单无 edit/shell 写 | Claude plan/review |
| `sandbox` | OS/CLI sandbox 限制写工作区 | Grok `--sandbox read-only`；Codex `-s read-only` |
| `isolation+probe` | 临时副本执行 + 事后 touchedFiles | Antigravity 现网 |
| `best-effort` | 仅 prompt/弱约束；**doctor 必须标明** | 降级路径 |

**WriteProbe（验收）：** plan/review 后目标工作区 `git status` 无变更（state 目录在仓外）。  
验收标准改为：**按 capabilities.readOnlyLevel 达标 + WriteProbe**，不宣称四 Target 同等绝对只读。

---

## 9. Target 规范（黄金路径）

> 来源：现网 bridge、CLI help、Grok user-guide、codex-plugin-cc（仅参考）。  
> 实现以单测锁 argv；变更 CLI 时先改本节与测试。

### 9.0 授权与执行中权限（产品约定）

#### 账号授权

| 规则 | 说明 |
|------|------|
| Bridge **不代登** | 不弹浏览器、不代填 token；各 Target 用本机已有登录 |
| 额度 | 记在 **被调 Target** 的账号/订阅上 |
| ready | `setup` / `doctor` 检查 bin +（能查则查）auth；未 ready 则委派失败，提示用户自行 `xxx login` |
| 禁止精简 | 见 §3.4；避免子进程丢掉 OAuth/正常配置 |

| Target | 登录（用户事先完成） | ready 探测（方向） |
|--------|----------------------|--------------------|
| Claude | `claude auth login` 或 API Key | `claude auth status` → loggedIn |
| Codex | `codex login` 等 | version + auth/doctor 可探测部分 |
| Grok | Grok 本机登录 | version + 文档侧 auth 探测 |
| Antigravity | 用户自备 `agy` 登录 | 现网以 bin 可用为主；运行期认 auth 错误 |

#### 工具权限（执行过程中）

| 规则 | 说明 |
|------|------|
| **目标：零交互** | plan / review / rescue / rescue --write 在 headless 下 **不得**依赖「等人点允许」 |
| 机制 | 启动时写死 tools / permission-mode / sandbox / isolation / approval（见 §9.x） |
| 弹窗 = bug | 子 agent 执行中卡住等人批 → adapter 规范未达标，须修 argv，不当产品特性 |
| 自动拒 | 只读路径写文件、deny 规则命中 → 工具失败或任务 fail，可接受 |
| Host 侧 | Host 可能询问 **是否允许跑 bridge/wrapper 命令**（如 Codex escalated）；那是 Host 批 shell，不是 Target 内逐工具询问 |

流水：

```text
Host 已登录 → 调 wrapper
  →（可能）Host 批一次「允许执行 bridge」
  → Core 门禁 → Adapter headless argv（已含权限档）
  → spawn Target（用其本机登录，执行中不逐条问人）
  → JSON / job 结果
```

### 9.1 Claude — 状态 ✅（现网已验证）

| Kind | 规范 |
|------|------|
| 入口 | `claude -p --output-format json`；prompt **stdin** |
| plan | `--tools Read,Glob,Grep` + `--permission-mode dontAsk` |
| review / adversarial | Core 预采 git + `--tools ""`（none） |
| rescue 只读 | `--tools Read,Glob,Grep`；permission 保持非交互可完成（与 plan 一致优先 `dontAsk`） |
| rescue write | `--tools Read,Glob,Grep,Edit,MultiEdit,Write`；**非交互可完成**（禁 bypass；具体 mode 以现网+实测写入测试，不得靠弹窗批 Edit） |
| 禁止 | `bypassPermissions`；`--dangerously-skip-permissions` 等（现网黑名单） |
| setup | `claude --version` + `claude auth status` → `loggedIn` |
| 嵌套硬化 | **禁止 `--bare` / `--safe-mode`**；NESTED；skill 禁止再委派（不靠精简模式） |
| capabilities | plan=emulated, review=precollect, readOnly=tool-profile, headlessZeroInteractive=true（plan 路径） |
| 后台 | Core job 为主；可选评估原生 `--bg`（非 V1 必须） |

### 9.2 Codex — 分层 L1 / L2 / L3

参考：CLI help + [codex-plugin-cc](https://github.com/openai/codex-plugin-cc)（**不照搬默认写**）。

| Level | 传输 | 用途 | V1 |
|-------|------|------|-----|
| **L1** | `codex exec` | plan / 通用 rescue | **必做** |
| **L2** | `codex exec review` | review / adversarial（focus 进 prompt） | **必做** |
| **L3** | `codex app-server`：`review/start`、`turn/start`、`turn/interrupt` | 对齐官方质量/进度 | **分期**（Phase 2c+ 或 3） |

**L1/L2 安全默认（须实测零交互）：**

| Kind | 规范草案 |
|------|----------|
| plan | `codex exec -C <cwd> --sandbox read-only` + 覆盖 approval 为非交互（**对齐官方 app-server 的 `approvalPolicy: never` 语义**；具体 `-c` 键名以本机 codex 版本实测写入 adapter 测试） |
| review | **优先 L2** `codex exec review --uncommitted` 或 `--base <ref>`；sandbox read-only |
| rescue 只读 | exec + read-only sandbox |
| rescue write | exec + `workspace-write`；**仍禁止** dangerously-bypass 主路径 |
| 禁止 | `--dangerously-bypass-approvals-and-sandbox` 作为默认或 skill 可透传 |
| setup | `codex --version`；auth/doctor 可探测部分；L3 另检 `codex app-server --help` |
| 嵌套硬化 | NESTED；**禁止精简/bare**；默认不启用 `--ignore-user-config`；若为隔离 bridge skills 而改 config，**必须单测证明 auth 仍可用** 才允许 |
| capabilities | plan=emulated；review=native(L2) 或 app-server(L3)；readOnly=sandbox；transports 列表 |
| 输出 | L1/L2：`--json` JSONL 与/或 `--output-last-message`；parse 进统一 JSON |
| serviceName | 若 L3：自有名如 `agent_bridge`，不用 `claude_code_codex_plugin` |

### 9.3 Grok — 状态 📝（文档全，待实测）

来源：`~/.grok/docs/user-guide/14|18|22`。

| Kind | 规范草案 |
|------|----------|
| 入口 | `grok -p --output-format json` |
| plan | `--tools read_file,grep,list_dir` + `--disallowed-tools Agent` + **`--sandbox read-only`** + 禁 MCP/Edit/Write（`--deny 'MCPTool(*)'` 等，**实测**） + permission：`dontAsk` 或文档推荐的非交互组合 |
| review | 预采 git **或** 只读 tools+sandbox；adversarial 改 prompt |
| rescue 只读 | 同 plan 工具集 |
| rescue write | 放开 edit 类 tools；文档倾向 automation 用 always-approve **并** deny 危险规则 — **仅 write 路径评估**，默认仍不 yolo |
| 禁止主路径 | 无 harden 的裸 `--yolo` |
| 注意 | **仅 `--tools` 不能去掉 MCP meta-tools**（文档原文） |
| 嵌套硬化 | `--disallowed-tools Agent`；NESTED；**禁止精简/bare**；不靠关掉正常认证减 skills |
| capabilities | plan=emulated；review=emulated/precollect；readOnly=sandbox（达标后）；headless 须测 |
| Plan mode | 交互态工具，**不是** headless 等价；不宣称 native plan |

### 9.4 Antigravity — 状态 ✅（现网已验证）

| Kind | 规范 |
|------|------|
| 入口 | `agy -p "<prompt>"`；prompt 为 `-p` 的值（紧跟其后，无 `--` 分隔） |
| 黄金 argv | `agy -p "<prompt>" --sandbox [--mode plan] --print-timeout 15m --output-format json`（write 路径无 `--sandbox`；`--mode plan` 仅 kind=plan） |
| model | 不传（capabilities.modelIgnored，用户决定）；模型跟随 settings.json |
| plan / review / 只读 rescue | **`--sandbox`** + **workspace isolation** + 事后 touchedFiles → 有改则 fail |
| rescue write | **无** `--sandbox`；真目录；禁止只读路径 `--resume` |
| 禁止 | `--dangerously-skip-permissions` |
| setup | bin version；auth 现网不查（ready≈available） |
| 超时 | 固定发送 `--print-timeout 15m`（API 层可被 timeoutMs 覆盖） |
| 输出 | `--output-format json` 信封（response/status/error/usage） |
| capabilities | plan=emulated；review=emulated；readOnly=**isolation+probe**；headless 依赖 sandbox 行为 |
| 嵌套硬化 | isolation + NESTED；**禁止精简模式**；CLI 表面薄 |

### 9.5 Kind × Target 能力一览

| | Claude | Codex | Grok | Antigravity |
|--|--------|-------|------|-------------|
| plan | emulated ✅ | emulated L1 | emulated 📝 | emulated ✅ |
| review | precollect ✅ | native L2/L3 | emulated 📝 | isolation ✅ |
| rescue 默认只读 | ✅ | ✅（**异于** codex-plugin-cc） | ✅ | ✅ |
| 零交互承诺 | plan 强 | 须测 | 须测 | 中 |

---

## 10. Host 发行面与安装

### 10.1 布局（多 Host 发行面并列）

```text
# Codex 原生 marketplace（整仓 add 友好）
.agents/plugins/marketplace.json          # 插件：claude-bridge, grok-bridge, antigravity-bridge
hosts/codex/plugins/...                   # 或 path 指向统一 plugins 树

# Claude 原生 marketplace
.claude-plugin/marketplace.json           # 插件：codex-bridge, grok-bridge, antigravity-bridge
hosts/claude/plugins/...                  # 对齐 codex-plugin-cc 形状时可放 plugins/ 下

# Grok
hosts/grok/skills/ 或 plugins/            # 按 Grok 文档惯例

# 可选：共享 skill 模板 → 生成进各 hosts
skills-templates/
src/                                      # 唯一 Core（npm 包）
```

插件源码可 **一份实现、多 Host 清单引用**（避免复制三份逻辑）；清单按 Host 过滤 self。

### 10.2 自选安装（marketplace 与 CLI 双通道）

**通道 A — 平台 marketplace（推荐有 UI 的用户）**  
在对应 Host 里 add 本仓对应清单 → 勾选要装的 Target 插件。

**通道 B — 统一 CLI**

```bash
agent-bridge install --host codex --list
agent-bridge install --host codex --targets claude,grok --apply
agent-bridge install --host claude --targets codex --apply
agent-bridge install --host grok --targets claude,antigravity --apply
```

- 默认 targets = `allowed(host)`；含 self → 失败  
- `--apply` 才写盘；默认 dry-run  
- 与 marketplace 装的是同一套 bridge 语义，可并存

### 10.3 Skill 粒度与减维（吸收 P1-2）

- 对外仍按 **Target ×（plan|review|rescue|result-handling）** 触发语义  
- **实现上** skill 正文由模板生成；host 差异仅 wrapper 名与 sandbox 说明三行  
- CI：`check-manifest` 断言无 self；扫描 skill 只调用 `agent-bridge-<host>`  

### 10.4 Host 调用约定

| Host | 约定 |
|------|------|
| Codex | companion 用 escalated sandbox；调 `agent-bridge-codex` |
| Claude | Bash 调 wrapper；可参考 codex-plugin-cc 的 slash/subagent **形状**，默认只读 rescue |
| Grok | `run_terminal_cmd` 调 wrapper；注意 sandbox allow |

### 10.5 不提供

- Codex Host 上的 codex-bridge  
- 默认 Stop review gate  
- 默认 session transfer  

---

## 11. 安全模型汇总

| 规则 | v2 |
|------|-----|
| 发行面无 self | ✅ |
| install 无 self | ✅ |
| Host lock + wrapper | ✅ 防装错 skill/发行面写错 host（不防本机故意伪造） |
| Nested + adapter 硬化 | ✅ 最低随 Target 交付 |
| plan/review 只读 + WriteProbe | ✅ 分级 |
| rescue 默认只读 | ✅（不照搬官方 CC 插件默认写） |
| 危险 flag 黑名单 | ✅ |
| 状态按 host 分桶 | ✅ |
| 不自动 commit/push | ✅ |
| env allowlist（§11.5 落地） | ✅ 继承层白名单（默认放行集 PATH/HOME/TERM/LANG/SHELL/USER/LOGNAME 等 + `AGENT_BRIDGE_*` + `AGENT_BRIDGE_ENV_ALLOWLIST` 追加）；`req.env` 显式层透传 |
| 密钥不进 prompt | ✅ skill |

---

## 12. 迁移

| 项 | 策略 | 状态 |
|----|------|------|
| 代码 | 抽 codex-agent-bridge Claude/Agy lib → Core + adapters | ✅ 已落地 |
| Codex Target | L1/L2 已落地；L3 app-server 分期 | ✅ L1/L2 |
| 发行面 | **marketplace 为唯一入口**（§5.1 npm 前提收窄：npm 不再是安装前提）；`agent-bridge install` 为统一补充通道（自动化/无 UI/批量 targets），不替代 marketplace | ✅ 成文（Phase 5） |
| 旧 env 名 | `CLAUDE_COMPANION_*` / `ANTIGRAVITY_COMPANION_*` 保留一个迁移期（新名 `AGENT_BRIDGE_*` 优先）；到期移除 | ✅ 成文（Phase 5） |
| 旧 job 状态 | **不强制迁移**：新 job 落新布局（§8.4），旧布局 job 保留可查；`cleanup` 按需清理 | ✅ 成文 |
| env 继承安全 | allowlist：默认放行集 + `AGENT_BRIDGE_ENV_ALLOWLIST`（§11.5），防 API 密钥/敏感 env 泄漏进目标 agent 上下文 | ✅ 已落地（Phase 5） |

---

## 13. 测试

| 层 | 内容 |
|----|------|
| Unit | args、lock/self/nested、storage、git-context |
| Adapter argv | 每 Target 黄金 argv 快照 |
| WriteProbe | plan/review fixture 仓 |
| Manifest | 发行面无 self；skill 只调 wrapper |
| Fake binaries | fake-claude/codex/grok/agy |
| 可选真实 smoke | 手工 / 带凭证 |

```bash
npm test
npm run check:manifest
```

---

## 14. 分期（修订）

| Phase | 内容 | 状态 |
|-------|------|------|
| **0** | package、cli 门禁、host lock/wrapper、install 过滤、空发行面、check-manifest | ✅ |
| **1** | Core job/state/git/storage + **Claude** adapter + WriteProbe | ✅ |
| **2a** | **Antigravity** 迁移 isolation | ✅ |
| **2b** | **Grok** adapter（含 MCP 禁用实测） | ✅ |
| **2c** | **Codex L1+L2**；零交互实测 | ✅ |
| **3** | Codex Host 发行面 + skills | ✅ |
| **4** | Grok Host + Claude Host 发行面 | ✅ |
| **5** | Codex L3 app-server（可选，未做）、env allowlist、worktree write、迁移说明 | ✅（除 L3） |
| **6** | 回传与存储卫生（截断/status 轻量/TTL）、后台 worker（--background/--wait/cancel）、marketplace 自足（插件打包+自举）、外部文件附件（--attach）、工程卫生 | ✅ 2026-08 交付 |

---

## 15. 验收标准（v2）

1. 任意 Host 发行面无 self；`check:manifest` 通过。  
2. `install --targets` 含 self 失败；默认 = allowed(host)。  
3. 无 lock 时委派类命令失败；`agent-bridge-codex claude plan` 在 lock=codex 下可过门禁。  
4. `agent-bridge-codex codex plan` → exit 3。  
5. `NESTED=1` → exit 4。  
6. 矩阵路径在对应 CLI ready 时可跑（按 Phase 交付）。  
7. plan/review：WriteProbe 通过 **或** capabilities 标明 best-effort 且 doctor 可见。  
8. rescue 默认无写；仅 `--write` 写。  
9. Job 闭环：background → status → result/cancel。  
10. `npm test` 不依赖真实 LLM。  
11. doctor 输出各 Target capabilities 与 transport。  

---

## 16. ADR 摘要

| 决策 | 选择 |
|------|------|
| 集成 | CLI companion，非 MCP |
| 发行面 | 按 Host 拆，无 self |
| Host 身份 | **lock + wrapper**，非可信 env |
| 分发 | **npm Core + 多 Host 原生 marketplace 并列 + install 统一补充** |
| Self | 禁止 |
| Rescue 写默认 | **只读**（异于 codex-plugin-cc） |
| Codex 传输 | L1 exec → L2 exec review → L3 app-server |
| Job 分桶 | per host/target/workspace |
| Skill | 模板生成，按 Target 触发 |
| 精简/bare 模式 | **全 Target 禁止**（§3.4 铁律） |
| 语言 | Node ESM ≥ 18.18 |

---

## 17. 文档地图

| 文档 | 角色 |
|------|------|
| **docs/design.md** | **本文：实现真源 v2** |
| docs/design-review.md | v1 审查历史 |
| docs/design-review-v2.md | v2 再审（历史） |
| docs/design-review-v3.md | **v3 终审（可 Phase 0）** |
| docs/agent-differences.md | 调研明细（可继续补实测记录） |
| docs/reference-codex-plugin-cc.md | 官方插件可借鉴/不可搬 |
| README.md / AGENTS.md | 入口与贡献约束 |

---

## 18. 下一步

1. ~~design v2~~（本文）  
2. **Phase 0** 脚手架与门禁实现  
3. Phase 1 Claude…

---

**设计 v2 结束。**
