# AgentBridge 设计审查报告

**审查对象：** `docs/design.md` **v1**（2026-08-06）  
**审查日期：** 2026-08-06  
**性质：** 架构 / 安全 / 可实现性 / 产品边界 的深入审查（实现前）  
**结论摘要：** 方向正确；v1 不宜直接全量实现。  

> **v2 状态：** 本报告中的 P0/P1 核心项已吸收进 **`docs/design.md` v2**（host lock、分发方案 A、只读分级、Codex L1–L3、nested 随 adapter、job 按 host 分桶、rescue 默认只读等）。  
> **实现以 design v2 为准**；本文保留为审查历史。

---

## 1. 总评

| 维度 | 评分 | 说明 |
|------|------|------|
| 问题定义 | 优 | 从 Codex 专用 companion 扩到多 Host/Target，痛点清楚 |
| 架构分层 | 优 | Core / Adapter / Host 发行面拆分干净，继承已验证路径 |
| Self / 可选装 | 良 | 产品意图正确；L3 存在 **失败开放** 与 **HOST 可伪造** |
| 安全默认 | 中 | 原则对；各 CLI headless 下「只读可执行且不挂起」未钉死 |
| 可实现性 | 中高 | Claude/Grok 较清晰；**Codex-as-Target、Antigravity 只读** 欠证据 |
| 打包分发 | 弱 | `AGENT_BRIDGE_ROOT`、marketplace 子路径、多 plugin 共享 Core **未定案** |
| 运维/并发 | 弱 | 双写冲突、job 跨 Host 共享、额度/成本未谈 |
| 可维护性 | 中 | 3×3×4 skill 面偏大；模板有提，生成/校验流程不够硬 |

**一句话：** 这是一份 **合格的 V1 产品架构草图**，不是 **可直接编码的规格说明书**。主干可保留；下列 P0/P1 必须写回 design 再实现。

---

## 2. 方案做得好的地方

1. **不重造编排器** — 复用各 agent 自己的 headless CLI，桥只做委派与约束，复杂度可控。  
2. **CLI-only 第一期** — 与 codex-agent-bridge 一致，易测、易 mock，跨 Host 行为一致。  
3. **一 Target 一 Bridge 包** — 避免「一个 skill 猜该叫谁」的路由灾难。  
4. **按 Host 拆发行面排除 self** — 比单靠 Runtime 更符合用户心智，也更适合 marketplace UI。  
5. **调用方自选 Target** — 降低技能噪音与误触发。  
6. **统一 JSON + job 生命周期** — Host skill 只学一套协议。  
7. **危险 flag 黑名单 + spawn(argv)** — 正确的默认姿态。  
8. **从现网抽取 Core** — 降低「从零发明 job/state」的风险。  
9. **验收标准可测试** — self/nested/manifest 适合做成 CI 门禁。  
10. **明确非目标** — 避免第一期膨胀成 agent 总线。

---

## 3. 严重问题（P0）— 实现前必须修订

### P0-1. `AGENT_BRIDGE_HOST` 信任模型错误：L3 可被「装错发行面」绕过

**现象：**  
L3 用 **声明的** `AGENT_BRIDGE_HOST` 与 `target` 比较，而不是 **真实正在运行的 Host 进程身份**。

**攻击 / 误用路径：**

1. 用户在 **Codex** 会话中，误装了 `hosts/claude/` 的 skills（或从错误目录软链）。  
2. Skill 写死 `AGENT_BRIDGE_HOST=claude`。  
3. 用户说「让 Codex 修一下」→ skill 调 `agent-bridge codex rescue --write`。  
4. L3：`host=claude`，`target=codex` → **放行**。  
5. 实际效果：在 Codex 里又拉起一个 Codex → **产品意义上的 self**，三层防御全部失效。

对称地：在 Claude 里装了 Codex 发行面 skills（`HOST=codex`）再 `agent-bridge claude ...` 也会放行。

**根因：**  
「Host」被建模成 **skill 配置项**，而不是 **运行时事实**。L1/L2 假设用户只装对的发行面；一装错，L3 帮倒忙（按错误身份放行）。

**修订建议（需写入 design）：**

| 层级 | 做法 |
|------|------|
| 检测 | `resolveHost()` = **观测信号优先**，声明值仅作校验 |
| 观测 | 进程树 / 已知 env（Codex、Claude、Grok 各自稳定标记）+ 可选 `agent-bridge` 被谁 spawn |
| 策略 | 若 **观测 host** 与 **声明 HOST** 不一致 → **失败**（配置错误），不要静默以声明为准 |
| 策略 | self 判定用 **观测 host**（若可观测）；声明仅双因子 |
| 不可观测 | 对 `plan|review|rescue`：**要求**能识别 host 或显式 `--host` 且来自受控 install 包装脚本，而不是「未知则放行」 |
| 包装 | 每 Host 安装生成 **薄 wrapper**：`agent-bridge-for-codex` 内置 host=codex 且不可被 skill 改成别的 |

最小可行补丁（比完美检测更现实）：

```text
install --host codex  → 写入 wrapper / 配置文件：host=codex locked
skills 只调用 wrapper，不直接传可伪造的 HOST
CLI 读 locked config；忽略或拒绝冲突的 AGENT_BRIDGE_HOST
```

---

### P0-2. Headless「无 bypass 且不挂起」未规格化 — 自动化会卡死或被迫危险

设计禁止 yolo / dangerously-bypass，但 **未给出各 Target 在非交互下如何自动批准「合法工具」**。

本机 CLI 事实：

| Target | 风险 |
|--------|------|
| **Codex** | `codex exec` 有审批与 sandbox；禁用 `--dangerously-bypass-approvals-and-sandbox` 后，headless 可能 **等人批准 → 挂起**。设计只写「适当 sandbox」，无具体 mode 矩阵。 |
| **Grok** | 无 `--yolo` 时工具可能走权限流程；文档中 headless 依赖 `--tools` / `--allow` / `--permission-mode`。设计未规定 **plan/review 必须带的 allow 规则集**。 |
| **Claude** | 需要明确 `--permission-mode`（旧实现用 dontAsk 一类）；设计只写「非 bypass」，**不足以实现**。 |
| **Antigravity** | `--sandbox` ≠ 完整 FS 只读；无 bypass 时 print 模式权限行为未写清。 |

**修订建议：**  
为每个 Target × Kind 增加 **「Headless 调用规范表」**，列死：

- 精确 argv 模板（含 permission / sandbox / tools）  
- 预期是否零交互  
- 若 CLI 无法在无危险 flag 下零交互，则 **该 Kind 降级**（例如仅 precollect + 无工具）或 **标记为不支持**  
- 禁止用「先挂起再超时」当设计  

**未完成该表之前，不要承诺四 Target 能力对等。**

---

### P0-3. 「只读」在 Grok / Antigravity / Codex 上不可由当前设计保证

| Target | 问题 |
|--------|------|
| **Grok** | 官方 headless：`--tools` allowlist 后 **「MCP meta-tools remain available unless denied」**。只给 `read_file,grep,list_dir` **不能**声称只读，除非 **显式禁用 MCP / 相关工具** 或隔离 MCP 配置。 |
| **Antigravity** | 现网靠 workspace isolation + sandbox 合成 plan；设计一句「沿用」但 Adapter 接口 **没有 isolation / workspace policy 字段**。 |
| **Codex** | 只读取决于 sandbox policy 与审批；未映射到 `read` profile。 |
| **Claude** | `Read,Glob,Grep` 相对最强；若 skill 误加 Bash，只读立刻破。 |

**验收标准第 6 条**（「plan/review 无法通过正式 CLI 表面写出工作区文件」）在当前设计下 **无法对全部 Target 诚实承诺**。

**修订建议：**

1. 定义可测试的 **WriteProbe**：fixture 仓 + 断言 plan/review 后 `git status` 无变更（允许 state 目录在仓外）。  
2. Adapter 必须实现 `assertReadOnlyInvocation(argv)` + 可选 post-run git dirty check。  
3. Grok：文档写明禁用 MCP 的具体手段（`--disallowed-tools`、空 mcp config、env）。  
4. Antigravity：把 isolation 升为 Core 一等能力或 Antigravity adapter 必选模块，而不是「经验沿用」一笔带过。  

---

### P0-4. 分发与 `AGENT_BRIDGE_ROOT` 未定案 — Host 插件无法诚实安装

设计要求 skill：

```bash
node "${AGENT_BRIDGE_ROOT}/src/cli.mjs" ...
```

但未回答：

1. Codex marketplace **每个 plugin 独立安装** 时，Core 在哪？  
   - 整仓 checkout？  
   - 每个 plugin 复制一份 `src/`？  
   - 全局 `npm i -g agent-bridge`？  
2. `codex plugin marketplace add <git>` 是否支持 **仅 hosts/codex 子树** 作为 marketplace 根？  
   - 旧项目是 **仓库根** marketplace。  
   - 若 **不支持子路径**，则 `hosts/codex/.agents/plugins/marketplace.json` 布局可能装不上，需要 **根目录 Codex-only marketplace** 或发布 **独立 codex 发行分支/包**。  
3. Claude / Grok 的 skills 如何保证 ROOT 指向同一 Core 版本（避免 plugin A 旧、plugin B 新）。  

**这是阻塞 Phase 3 发行面的产品问题，不是实现细节。**

**修订建议（三选一，设计必须选定）：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. npm 全局/本地 CLI + Host 只装 skills** | ROOT=which agent-bridge；版本单一 | 多一步 install；企业环境限制 npm |
| **B. 整仓作为 Codex marketplace，根 marketplace 只挂三插件；Core 在仓内共享** | 接近现网 | monorepo 被 Codex 拉全量；Claude/Grok 仍要另一安装路径 |
| **C. 每 plugin 打包进 Core 子集（vendor）** | 单 plugin 自包含 | 三份重复；升级痛苦 |

**推荐：A 为主（`agent-bridge` 上 PATH），B 为 Codex 可选「源码仓安装」；skills 优先调用 `agent-bridge` 而非 `node $ROOT/src/cli.mjs`。**

---

### P0-5. 全局门禁「NESTED 拒绝一切」语义过粗 + 嵌套防护过度依赖自觉

§5.3 任意 command 在 `AGENT_BRIDGE_NESTED=1` 时失败。通常 Host 不带 NESTED，问题不大；但：

1. **真环防护**：子 agent 若 **直接** `claude -p` / `codex exec` / `grok -p` 而不经 `agent-bridge`，NESTED **无效**。设计把 bare/去 skills 放 Phase 5，导致 **V1 环防护名不副实**。  
2. Skill 文案「不得再调 bridge」对模型 **无强制力**。  
3. Grok 默认可能带 skills/MCP；spawn 时若未剥 skills，子 Grok 仍可能「有手就能调」。  

**修订建议：**

- V1 将 **「子进程隔离」升为 P1 必做（随每个 adapter 交付）**，不要整包丢 Phase 5。  
- 最低标准：spawn env `AGENT_BRIDGE_NESTED=1` + 剥离 bridge skills / Claude `--bare`（若可用）+ Grok `--disallowed-tools Agent`（防子 agent 再开套）+ 文档声明残留风险。  
- 门禁表：`install`/`doctor` 在 NESTED 下可允许或明确禁止并写清。  

---

## 4. 高优先级问题（P1）

### P1-1. Self 在「HOST 未设置」时失败开放

§3.2：无法解析 host 时 **仍允许** 调用（方便人手 CLI）。  

结果：skill 漏写 `AGENT_BRIDGE_HOST` → L3 形同虚设。  

**建议：**

- `plan|review|adversarial-review|rescue`：**必须** 有 host（wrapper / `--host` / locked config）。  
- `setup|doctor|install|storage|cleanup`：允许无 host。  
- 人手调试：显式 `--host none` 或 `AGENT_BRIDGE_ALLOW_UNSCOPED=1`，默认文档不鼓励。  

---

### P1-2. Skill 组合爆炸（3 Host × 3 Target × ~4 skill ≈ 36）

模板有提，但未规定：

- 生成器是否为唯一真源  
- CI 是否拒绝手改生成物  
- result-handling 能否 **每 Target 一份跨 Host 共享**（仅 wrapper 不同）  

**建议：**  
Skill 减维：

```text
per (host, target): 1 个 skill 包内多 command 说明
或 per target: 4 个 skill 内容相同，host 差异仅 wrapper 三行
```

优先 **减少重复**，否则文案漂移必然。  

---

### P1-3. Codex-as-Target 能力与「排除 self」并存时的产品空洞

- Codex Host **不能** 委派 Codex（正确）。  
- Claude/Grok Host **需要** 强 Codex adapter。  
- 团队若主用 Codex，**最常用 Host 用不到 Codex adapter** → Codex adapter 的投入产出比取决于 Claude/Grok 用户占比。  

不是错误，但是 **优先级**：Phase 2 把 Codex adapter 与 Grok 并列，对「Codex 主力用户」价值偏低。  

**建议：** Phase 2 顺序改为 **Antigravity（迁）→ Grok → Codex**，或按真实 Host 占比排序；在 design 写明。  

---

### P1-4. Job 状态键未含 Host，跨 Host 语义不清

```text
$STATE_ROOT/<target>/<workspace-hash>/
```

同一机器上 Codex 与 Claude 先后调 Grok：

- job id 是否共享可见？  
- cancel 是否允许「另一个 Host 取消」？  
- 是否符合最小惊讶？  

**建议：** 明确产品语义二选一：

1. **共享**（同工作区同 target 全局 job 总线）— 需 ACL 说明；或  
2. **按 host 分桶** `$STATE_ROOT/<host>/<target>/<ws>/` — 更简单、更安全。  

推荐 V1 用 **2**。  

---

### P1-5. `rescue --write` 并发与回滚

两 Host 或 Host + Target 同时写同一工作区：无锁、无 worktree 默认策略。  

Antigravity 旧实现有 isolation；通用 Core 没有。  

**建议：**

- V1 skill：**写前要求干净 git 或明确 --cwd**；禁止默认同目录并行 write。  
- V2：可选 git worktree per job。  
- touchedFiles + 建议用户 `git diff` 验收写入 design 正文，不只 skill 习惯。  

---

### P1-6. 统一命令面 vs 能力不对等被掩盖

四 Target 都暴露 `plan/review/rescue`，但 Antigravity plan 是「合成」、Codex review 可能应用 `codex exec review` 子命令（本机存在 `codex exec review`），Grok 工具名不同。  

**风险：** 用户以为行为等价，结果质量与副作用分布差很大。  

**建议：**  

- 对外仍统一 verb；  
- `setup`/`doctor` JSON 增加 `capabilities: { plan: "native"|"emulated"|"degraded", readOnlyGuarantees: "tool-profile"|"sandbox"|"best-effort" }`；  
- README 用表格诚实降级。  

---

### P1-7. 安装器权限与供应链

`npx agent-bridge install --host ...` 写用户 `~/.codex` / `~/.claude` / `~/.grok`：

- 未定义 dry-run 以外的审计日志  
- 未定义卸载是否干净  
- 未定义是否改 marketplace git 配置  

**建议：** install 只做：(1) 检查 CLI (2) 链接 skills (3) 打印「请用官方 UI 完成的步骤」；**少自动改全局 config**。危险操作显式 `--apply`。  

---

### P1-8. 门禁顺序与 `target` 对非委派命令

`agent-bridge doctor --host codex` 的 CLI 形状与 `agent-bridge <target> setup` 不一致。  
`install` 无 target。设计混在同一入口未写清解析器语法。  

**建议：** 语法固定为：

```text
agent-bridge <target> <cmd> ...     # 委派域
agent-bridge doctor|install|...     # 元命令，无 target
```

解析器规范进 design，避免实现分叉。  

---

## 5. 中优先级（P2）— 规格缺口

### P2-1. Adapter 接口不完整

缺：

- `supportsNativeBackground` 有，但无 **lifecycle 对接**（Claude `--bg` vs Core job 双轨谁为准）  
- 无 `prepareEnvironment(req): env`（NESTED、剥离 config、CODEX_HOME 临时目录）  
- 无 `readOnlyPostCheck(cwd)`  
- 无 capability 声明  
- `parseResult` 对 **半截 JSON / stream-json / 多行** 未定义  

### P2-2. 错误码与 JSON 同时存在时的契约

exit 3/4 时 stdout 是否仍是 JSON？Skill 如何解析？应规定：**永远可 `--json` 包一层 error**。  

### P2-3. 模型 / effort 透传

各 CLI 模型名不同；无效 model 是 adapter 错误还是透传失败？需统一错误形状。  

### P2-4. Prompt 注入与跨 agent 信任

Host 把用户 prompt 原样给 Target：Target 若有 write，存在 **通过 plan 话术骗 Host 再 rescue --write** 的社会工程链。  

Skill 已要求写意图来自用户；建议加：**不得根据 Target 的 plan 文本自动加 --write**。  

### P2-5. 密钥与环境继承

`spawn` 默认继承 env → API key、AWS、npm token 进子 agent。  

设计只禁「prompt 里塞密钥」，**未谈 env 继承策略**。  

建议：可选 `env` allowlist；至少文档警告。  

### P2-6. 超时与 `--print-timeout`（agy 默认 5m）

Core 不默认 timeout，但 agy 自带 print-timeout；行为不一致应在 adapter 写明。  

### P2-7. Windows / 无 Node 场景

强制 Node 18+；若用户只有 Codex 二进制无 Node，companion 挂。需写系统要求。  

### P2-8. 可观测性

无 log 级别、无 trace id 贯穿 Host→Core→Target，排障难。V1 可简单：job id 打进子进程 env `AGENT_BRIDGE_JOB_ID`。  

### P2-9. 版本兼容矩阵

未定义「agent-bridge 1.x 支持 claude ≥?、codex ≥?」。应用 `setup` 做最小版本检查。  

### P2-10. 旧版迁移

兼容 env 一两个版本 OK；marketplace 重定向、状态目录迁移、技能重命名表应在 Phase 3 交付物中强制列出。  

---

## 6. 安全模型专项

| 控制 | 设计状态 | 审查意见 |
|------|----------|----------|
| 发行面无 self | 强 | 保持；CI 必测 |
| install 无 self | 强 | 保持 |
| Runtime self | **弱** | 见 P0-1、P1-1 |
| Nested | **弱到中** | env 有用但不充分；见 P0-5 |
| 只读 plan/review | **声明强、保证弱** | 见 P0-3 |
| 危险 flag 黑名单 | 中 | 无法防「模型在子 CLI 内自己请求 bypass」若子 CLI 允许交互批准 |
| 状态外置 | 强 | 保持；注意 P1-4 分桶 |
| 不自动 commit | 强 | 保持 |
| Prompt 机密 | 中 | skill 级；加 env 继承警告 |
| 供应链 install | 弱 | 见 P1-7 |

**「只读」正确层级（建议写入 design）：**

```text
L0 Prompt 约定          — 最弱
L1 Tool/sandbox 配置    — 中（实现重点）
L2 事后 git dirty 检测  — 强可测
L3 文件系统 sandbox     — 最强（可选 OS sandbox）
```

V1 应对 Claude 争取 L1+L2；对 Grok/Agy/Codex 如实标注所能达到的最高 L。  

---

## 7. Self / Nested 逻辑压力测试

| 场景 | 期望 | 当前设计 | 结果 |
|------|------|----------|------|
| Codex + 官方 codex 发行面 + claude plan | 允许 | 允许 | OK |
| Codex + 调 codex | 拒绝 | 发行面无入口；若手敲且 HOST=codex 拒绝 | OK |
| Codex + 误装 claude 发行面 + 调 codex | 拒绝 | **允许** | **FAIL P0-1** |
| Skill 漏 HOST + 调任意 | 应拒绝委派 | **允许** | **FAIL P1-1** |
| Claude→Grok→agent-bridge claude | 拒绝 | NESTED 若继承则拒绝 | OK（条件） |
| Claude→Grok→直接 claude -p | 拒绝/削弱 | **不覆盖** | **FAIL 残余** |
| 用户终端无 HOST 调 claude plan | 调试允许？ | 允许 | 产品需二选一 |
| ALLOW_SELF=1 | 仅测试 | 有 | OK，防泄漏到 README |
| 并行两个 write rescue | 未定义 | 未定义 | 风险 |

---

## 8. 与参考实现的差距（容易低估）

codex-agent-bridge 已处理而本设计 **一笔带过** 的部分：

1. Antigravity **workspace isolation**  
2. Review **diff/untracked 截断与 metadata**（有数字，缺模块职责）  
3. Codex Host **require_escalated** 与 skill 文案耦合（有）  
4. Storage prune 与 active job 保护（有纲要）  
5. 假 binary fixture 契约（有提，无 IO 协议）  
6. **前台捕获 stdout 过大**（旧设计已知债：archival cap ≠ runtime cap）— 新设计未继承该风险说明  

建议：把「已知技术债」整节从旧设计迁过来，避免 V1 重复踩坑。  

---

## 9. 架构决策再评议

| 决策 | 是否站得住 | 备注 |
|------|------------|------|
| CLI-only 非 MCP | 是 | 保持；MCP 真有需求再加薄封装 |
| 按 Host 拆发行面 | 是 | 但要解决根 marketplace 路径（P0-4） |
| 禁 self | 是 | 加强检测（P0-1） |
| Core 含全部 adapter | 是 | 发行面过滤即可 |
| 统一 verb | 是 | 需 capability 降级透明（P1-6） |
| Node ESM | 是 | 写清运行依赖 |
| 同 Target 双开不做 | 是 | 保持 |
| NESTED 仅 env | **不足** | 加强隔离（P0-5） |

**不建议** 此时改成「纯 MCP 总线」或「单一超级 skill 路由」——会丢掉现网验证过的优势。  

---

## 10. 分期计划评议

| Phase | 评议 |
|-------|------|
| 0 门禁+manifest | 正确优先；应 **加入 locked-host wrapper 决策** |
| 1 Core+Claude | 正确；应用 WriteProbe 定「只读」基线 |
| 2 三 adapter 并行 | **过胖**；按风险/价值拆：Agy 迁 → Grok → Codex；每完成一个就过 WriteProbe+headless 零交互 |
| 3 Codex Host | 依赖 P0-4 分发定案 |
| 4 其他 Host | 依赖 install 最小权限模型 |
| 5 硬化 | **部分内容应前移**（子进程隔离、Grok MCP 禁用） |

---

## 11. 必须写回 design 的修订清单（按优先级）

### 必须（block 实现）

1. **Host 身份：** locked wrapper / 观测 host；禁止仅凭可伪造 env 做 self 放行。  
2. **分发模型：** 选定 npm CLI vs monorepo marketplace vs vendor（推荐 npm CLI + skills）。  
3. **Codex marketplace 根路径** 与仓库布局对齐（根 marketplace 或可证实的子路径）。  
4. **每 Target×Kind headless argv 规范表** + 零交互证明策略。  
5. **只读保证分级** + WriteProbe 验收；Grok MCP 明确禁用方式。  
6. **Antigravity isolation** 写入 adapter/Core 职责，不写「沿用」空话。  

### 应当（V1 含）

7. 委派类命令强制 host scoping。  
8. Job 状态按 host 分桶。  
9. Skill 减维与生成/CI 策略。  
10. 子进程隔离随 adapter 交付。  
11. capabilities 在 doctor/setup 暴露。  
12. 错误 JSON 与 exit code 双契约。  
13. env 继承与并发写风险说明。  

### 可以（V1.1+）

14. worktree per write job  
15. MCP 薄封装  
16. 完整 OS sandbox  
17. 跨 Host job ACL  

---

## 12. 修订后的建议架构补丁（概念）

```text
                    ┌─ install --host codex ─┐
                    │  生成 ~/.agent-bridge/  │
                    │  hosts/codex.lock       │  host=codex (不可被 skill 改写)
                    │  bin/agent-bridge-codex │  → 强制 --host codex
                    └───────────┬────────────┘
                                │
         skills 只调用 agent-bridge-codex <target> ...
                                │
                                ▼
                     CLI: 校验 target ∈ allowed(codex)
                          校验 target ≠ codex
                          设置 NESTED 于子进程
                                │
                     Adapter.buildInvocation + hardenEnv
                          （去 skills / 禁 MCP / sandbox）
                                │
                     postCheck: plan/review → git clean
```

相对原文：把 **「信任 skill 传 HOST」** 改成 **「信任 install 写入的 host lock + wrapper」**。

---

## 13. 审查结论

| 项 | 结论 |
|----|------|
| 是否推翻重来？ | **否** |
| 是否可按文档直接编码？ | **否**（先修订 P0） |
| 最大结构性漏洞 | **HOST 可伪造导致 self 门禁被绕过**；**只读与 headless 零交互未钉死**；**分发/ROOT 未定** |
| 最大产品价值保留点 | 按 Host 拆货架、可选 Target、统一 Core、禁 self 的产品叙事 |
| 下一步 | 出 **design.md v2 修订**（或 ADR 补丁章节）→ 再 Phase 0 |

---

## 14. 建议的立即行动

1. 评审会只开 P0 六项，达成书面选择（尤其分发模型 A/B/C 与 host lock）。  
2. 更新 `docs/design.md` 增加：  
   - §3.4 Host 身份与 lock  
   - §5.6 元命令语法  
   - §6.5 Headless 规范表（可先填 Claude，其它标 TBD+风险）  
   - §8.0 分发模型  
   - §10 只读保证分级  
3. 用修订后的验收标准替换第 6 条「全 Target 绝对只读」为 **分级+探针**。  
4. 再开工 Phase 0。  

---

**审查结束。**
