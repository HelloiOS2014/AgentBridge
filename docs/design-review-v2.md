# AgentBridge 设计审查报告 v2

**审查对象：** `docs/design.md` **v2.0**  
**审查日期：** 2026-08-06  
**性质：** 实现前规格再审（对照 v1 审查、差异附录、codex-plugin-cc 参考、AGENTS.md 一致性）  
**总评：** **可以进入 Phase 0**；v1 的阻塞性 P0 已基本闭合。仍有 **规格缝隙与实现风险（R1–R12）**，应在 Phase 0–2 内收敛，不必再开一轮大改 design 才能写代码。

---

## 1. 总评

| 维度 | v1 | v2 | 说明 |
|------|----|----|------|
| 问题与边界 | 优 | 优 | 非目标更清晰（transfer/gate/L3 分期） |
| 架构分层 | 优 | 优 | 未动摇 |
| Self / 装错发行面 | 弱 | **良–优** | host lock + wrapper 闭合 P0-1 |
| 分发 / ROOT | 弱 | **优** | 方案 A 定案 |
| 只读诚实度 | 弱 | **良** | 分级 + WriteProbe |
| Target 差异 | 摘要 | **良** | §9 黄金路径；Grok/Codex 仍有「须实测」 |
| Headless 零交互 | 未钉 | **中–良** | Claude/Agy 有据；Codex/Grok 显式待测 |
| Host 发行可操作性 | 中 | 良 | 多 Host marketplace 并列（§5.4） |
| 可维护性 | 中 | 中 | skill 模板有方向，生成器未规格化 |
| 可直接编码？ | 否 | **Phase 0 可；adapter 边做边实测填空** | |

**相对 v1 结论变化：** 从「先修 P0 再动手」→「**可以按分期开工**，开放项用实测门禁消化」。

---

## 2. v1 P0 闭合核对

| v1 P0 | v2 处置 | 闭合？ |
|-------|---------|--------|
| P0-1 HOST 可伪造 | §3 host lock + wrapper + 委派强制 lock | **是**（见残余 R1） |
| P0-2 headless 零交互未规格 | §9 分 Target 规范；Claude/Agy 钉死；Codex/Grok 标须测 | **部分**（有路径，无最终 argv 字面量） |
| P0-3 只读不可保证 | §8.5 分级 + WriteProbe；验收不吹嘘 | **是**（产品诚实） |
| P0-4 分发/ROOT 未定 | §5 方案 A | **是** |
| P0-5 nested 过弱 | §3.3 随 adapter 硬化；残余直接调 CLI 声明 | **可接受** |

v1 P1 吸收情况：job 按 host 分桶 ✅；skill 减维方向 ✅；CLI 元命令语法 ✅；capabilities ✅；错误 JSON ✅。  
未完全写死：env allowlist（V1.1）、write 并发锁、Codex marketplace 二选一。

---

## 3. 做得好的地方（v2）

1. **Host lock 把安全模型从「信 skill」改成「信 install 产物」**——方向正确。  
2. **分发 A** 解决多 plugin 共享 Core 的工程死结。  
3. **Rescue 默认只读** 与 codex-plugin-cc 刻意分叉，写进 ADR，避免实现时被「官方默认」带偏。  
4. **Codex L1/L2/L3** 既尊重官方 app-server，又控制 V1 范围。  
5. **只读分级** 让 Antigravity isolation 与 Claude tools 可同框比较。  
6. **§9 状态标注**（✅/📝）避免假进度。  
7. **分期 2a/2b/2c** 比「四 adapter 并行」可交付。  
8. **失败也出 JSON + 稳定 exit code** 利于 Host skill。  
9. **NESTED 对元命令也拒绝** 减少子会话里 install/doctor 绕路（有利有弊，见 R4）。  
10. 文档地图与 AGENTS 对齐 v2，减少「多真源」。

---

## 4. 剩余问题（按严重度）

### R1 — 本机「伪造 wrapper」— **不作问题**

产品判断：本机用户若故意伪造 lock/wrapper 套自己，不值得防护、不写进威胁清单。  
Host lock **只**服务装错 skill / 发行面时的 self 误触发。

---

### R2 — Codex L1 `approvalPolicy: never` 的 **exec 映射未钉死**（中高 / 可实现性）

**现状：** §9.2 写「对齐 never 语义；`-c` 键名以实测写入测试」。  

**风险：** Phase 2c 可能卡在「找不到稳定非交互配置」；与用户全局 `approval_policy=on-request` 冲突。  

**建议：**

- Phase 2c **第一个任务**就是：用 fake/真实 codex 固定一组可重复的 L1 argv（含是否必须 `--ignore-user-config`）。  
- 若 exec 路径无法零交互，**提前降级决策**：review 走 L2；plan/rescue 标 `headlessZeroInteractive=false` 或加快 L3。  
- 不要在 Phase 0–1 假装 Codex 已闭环。

---

### R3 — Grok 黄金 argv 仍是草案（中 / 可实现性）

**风险点：**

- `dontAsk` + sandbox + tools + deny MCP 的 **组合是否零交互** 未测。  
- `--deny 'MCPTool(*)'` 语法是否匹配实现。  
- `todo_write` 等「只读工具」是否造成工作区外副作用（一般可接受）。  
- write 路径是否最终要 always-approve + deny。

**建议：** Phase 2b 开工清单 = 一张「实测矩阵」勾选后才标 capabilities.headlessZeroInteractive=true。

---

### R4 — `NESTED=1` 拒绝 **一切** 含元命令（中 / 产品）

**影响：** 子 agent 环境若继承 NESTED，则无法在子会话里 `agent-bridge doctor`（有意），但也可能让 **用户误在嵌套 shell 里调试** 困惑。  

**建议：** 文档一句；或仅对委派类 + install 拒绝，允许 `doctor --json` 只读诊断（可选，非必须）。

---

### R5 — `status/result/cancel` 与 host 分桶规则含糊（中 / 规格缝）

§6.2：「需要 host 分桶时使用 lockedHost；无 host 时仅调试」。  

未写清：

- skill 调 `status` 是否 **必须** 走 wrapper（建议：**必须**，与委派同一 lock）。  
- job-id 是否全局唯一还是仅 host 内唯一。  
- `--all` 是否跨 target。

**建议 Phase 0 定死：**

```text
status|result|cancel|storage|cleanup 与 plan 相同：需要 lockedHost
job id：在 host+target+workspace 内唯一（或全局 UUID，查找时带 host）
```

---

### R6 — marketplace 是否只能 Codex — **已纠正**

误写「根 marketplace 只给 Codex、其它 Host 只能 install」——**否**。  

正确：**同一 monorepo 多平台清单并列**（Codex `.agents`、Claude `.claude-plugin`、Grok 自有路径），各清单只含非 self targets；`install` 是补充通道不是唯一通道。见 design §5.4 / §10.1。

---

### R7 — Wrapper 上 PATH 与 Codex sandbox（中 / 运行时）

Codex Host 调 companion 要 **escalated**；wrapper 在 `~/.agent-bridge/bin`：

- 默认 PATH 可能没有该目录 → skill 找不到命令。  
- install 必须：写入 PATH 说明、或 **绝对路径** 写进 skill、或链到 `~/.local/bin`。

**建议：** skill 模板使用 **install 时展开的绝对路径**（最稳），不依赖用户改 PATH。

---

### R8 — 精简 / bare — **已定铁律，不作开放项**

产品铁律：**所有 agent 禁止精简/bare/minimal 模式**（含嵌套）。见 design §3.4。  
审查中曾讨论的「是否默认 bare」作废；实现与 CI 应拒绝相关 flag。

---

### R9 — WriteProbe 与 isolation 双计（低 / 实现）

Antigravity 已在隔离仓跑 + touchedFiles；Core 再对 **原 cwd** WriteProbe 恒绿。  

**建议：** isolation 路径以 adapter `postReadOnlyCheck` 为准；Core 通用 probe 作用于 **实际写入的 cwd**（isolated 或 real）。

---

### R10 — Skill 数量与触发（中低 / 产品）

3 host × 3 target × 4 ≈ 36 skill 名；Grok/Claude 自动加载可能 **噪声大**。  

**建议：**  

- install 只链用户 `--targets`；  
- skill description 写清「仅当用户点名该 Target」；  
- 评估每 Target 合并为 1 个 skill 多 command（实现后期可做，不挡 Phase 0）。

---

### R11 — 版本耦合与 semver（中低）

npm `agent-bridge` 与 hosts skills **版本必须匹配**；skill 调旧 CLI 会炸。  

**建议：**  

- `doctor` 打印 cli version + skill pack version；  
- lock 文件写 `cliVersion`；  
- 主 CLI 启动检查 skill 期望的 major。

---

### R12 — 文档内部小不一致（低）

| 点 | 说明 |
|----|------|
| §5 写「见 §12」marketplace，§12 是迁移 | 应为 §5.4 / §10 |
| §6.1 委派可用 `--host`，§3.2 又强调仅 wrapper | 开发模式 `DEV_ROOT --host` 与生产 wrapper 需一句「生产 skill 禁止裸 --host 除非 ALLOW」 |
| `setup` 在 command 列表且可无 host | 与「委派强制 host」一致，但 `agent-bridge claude setup` 无 host 是否允许？§3.2.4 说 setup 可不要求 host —— **OK**，解析器要支持 `agent-bridge <target> setup` 无 --host |
| AGENTS 写 state 分桶 host/target | 与 design 一致 ✅ |

---

## 5. 安全模型压力测试（v2）

| 场景 | 期望 | v2 | 结果 |
|------|------|-----|------|
| 正确 wrapper + 非 self target | 放行 | 放行 | OK |
| 正确 wrapper + self target | 拒绝 | exit 3 | OK |
| 无 lock 委派 | 拒绝 | exit 2 | OK |
| 装错 skill 但仍用 **正确** wrapper | self 仍拒；错误 target 名才误委派 | 比 v1 好 | OK |
| 恶意自建 wrapper 伪 host | 不防护 | 不当需求 | 忽略 |
| NESTED 再入 bridge | 拒绝 | exit 4 | OK |
| 子 agent 直接 claude -p | 不保证 | 声明残余 | 接受 |
| plan 写工作区 | fail | WriteProbe / isolation | OK（分级） |
| skill 根据 plan 自动 --write | 禁止 | §8.1 | OK（文案层） |
| Grok MCP 写文件 | 须 ban | §9.3 | 待测 |
| Codex 卡审批 | 须 never 映射 | §9.2 | 待测 |

---

## 6. 与参考实现的一致性

| 来源 | v2 是否对齐 |
|------|-------------|
| codex-agent-bridge 只读 rescue、job、companion | 是 |
| codex-agent-bridge Claude argv | §9.1 是 |
| codex-agent-bridge Agy isolation | §9.4 是 |
| codex-plugin-cc companion 形状 | 是（Host 层） |
| codex-plugin-cc app-server 默认 | L3 分期；approval/sandbox **语义**采纳 |
| codex-plugin-cc 默认 write rescue | **刻意不对齐**（正确） |

---

## 7. 分期可行性

| Phase | 风险 | 是否可开 |
|-------|------|----------|
| 0 | R5/R6/R7 应顺手定 | **可开** |
| 1 Claude | 低（现网） | 可开 |
| 2a Agy | 中（isolation 抽公共） | 可开 |
| 2b Grok | **高**（R3） | 可开但门禁严 |
| 2c Codex L1/L2 | **高**（R2） | 可开但允许降级 |
| 3–4 Host | 依赖 0 的 PATH/绝对路径 | 可开 |
| 5 L3 | 大 | 可选 |

---

## 8. 建议在 Phase 0 一并钉死的「小规格」（不必再开 design v3）

写入实现 issue / 短补丁 design 即可：

1. **多 Host marketplace 清单就位**（Codex + Claude + Grok 路径），CI 各校验无 self。  
2. **status/result/cancel 靠 UUID 即可**（不必强制 host）。  
3. **Skill 内 CLI 绝对路径**（install/marketplace 生成）。  
4. **解析器：** `setup` 允许无 host；委派须 host lock。  
5. **全 Target 禁止 bare/精简**（铁律）。

---

## 9. 是否需要 design v3？

| 判断 | |
|------|--|
| 需要重写架构？ | **否** |
| 需要再等外部参考源？ | **否** |
| 可以 Phase 0？ | **是** |
| v3 触发条件 | Codex/Grok 实测证明 L1 路径不可行，或要改分发模型 |

---

## 10. 审查结论

| 项 | 结论 |
|----|------|
| v2 是否达到「可编码规格」？ | **对 Phase 0–1：是**；对 Grok/Codex adapter：**带实测门禁的可编码规格** |
| 最大剩余风险 | Codex 非交互映射（R2）、Grok MCP/权限组合（R3）、wrapper 绝对路径（R7） |
| 最大已修复 | 装错 host 门禁、分发、只读诚实度、差异章节、Codex 分层 |
| 推荐行动 | **批准 Phase 0**；顺手定 R5/R6/R7/不默认 bare；不折腾「防伪造」 |

---

## 11. 检查清单（给实现者）

- [ ] lock 文件 schema + wrapper 生成  
- [ ] 门禁单测：self / nested / no-lock / allowed  
- [ ] check-manifest 无 self  
- [ ] install dry-run / apply  
- [ ] skill 绝对路径生成  
- [ ] 多 Host marketplace 清单路径 + 无 self 校验
- [ ] doctor 骨架（capabilities 可先硬编码）  
- [ ] 文档威胁模型一句  

---

**审查 v2 结束。**
