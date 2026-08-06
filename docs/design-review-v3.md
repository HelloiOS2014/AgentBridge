# AgentBridge 设计审查报告 v3

**审查对象：** `docs/design.md` v2（含后续定案：多 Host marketplace、禁 bare、§9.0 授权、会话共识）  
**对照：** AGENTS.md、README.md、agent-differences、reference-codex-plugin-cc、design-review v1/v2  
**日期：** 2026-08-06  
**性质：** 实现前终审——**是否可进入 Phase 0、正文是否自洽、还剩什么实现风险**

---

## 1. 总评

| 维度 | 评分 | 说明 |
|------|------|------|
| 产品边界与非目标 | **优** | self / 默认只读 / 禁 bare / 不代登 / 零交互目标清楚 |
| 架构 | **优** | Core + Adapter + 多 Host 发行面；业界形态对齐 |
| 分发与 marketplace | **优** | 多平台清单并列 + install 补充；已纠正「只 Codex」 |
| 安全默认（务实） | **优** | 防装错，不防本地作死；禁精简；rescue 默认只读 |
| Target 差异 | **良** | Claude/Agy 可编码；Codex/Grok 方向对、argv 待实测 |
| 授权 / 执行权限 | **优** | §9.0 已写清：不代登、执行中不弹批、弹窗=bug |
| 文档自洽 | **中** | 正文与后续共识有 **几处未改干净**（见 §4） |
| 可否 Phase 0 | **是** | 修完 §4 小不一致后即可开工 |

**一句话：** 方案已够扎实，**可以进入 Phase 0**。不需要再开 design v3 重写；只需把聊天里已定、正文没跟上的 3～4 处改齐，并接受 Codex/Grok 的实测门禁。

---

## 2. 已锁定决策清单（终审确认）

| # | 决策 | 状态 |
|---|------|------|
| 1 | 4 Target × 3 Host，矩阵禁 self | 锁定 |
| 2 | CLI-only Core，非 MCP 第一期 | 锁定 |
| 3 | Host lock 防装错，不防伪造 | 锁定 |
| 4 | npm Core + **多 Host 原生 marketplace 并列** + install | 锁定 |
| 5 | Skill **绝对路径** 调 wrapper | 锁定 |
| 6 | Job **UUID**；查 status **不必强制 host**（共识） | 正文 §6.2 **未跟上** |
| 7 | rescue **默认只读** | 锁定 |
| 8 | **禁止一切 bare/精简** | 锁定 §3.4 |
| 9 | 不代登；执行中 **零交互** 工具批 | 锁定 §9.0 |
| 10 | Codex L1→L2→L3 分期 | 锁定 |
| 11 | 只读分级 + WriteProbe | 锁定 |
| 12 | 参考两仓只参考不整搬 | 锁定 |

---

## 3. 相对 v1/v2 审查：阻塞项

| 原问题 | 现状态 |
|--------|--------|
| HOST 可伪造当安全问题 | 已降级为非需求 |
| 只 Codex marketplace | 已纠正为多 Host |
| bare 嵌套 | 已铁律禁止 |
| 只读吹嘘 | 已分级 |
| 分发未定 | 已定 npm + 多 marketplace |
| 授权执行模式缺失 | 已有 §9.0 |
| Codex/Grok 零交互 argv | **仍为实现风险，非产品未定** |

**无新的架构级 P0。**

---

## 4. 正文自洽问题（建议 Phase 0 前小补丁，30 分钟级）

以下是 **文档没跟上已定共识**，不是重新争论：

### I1 — §6.2 与「status 靠 UUID」矛盾

§6.2 仍写：

> `status|result|cancel|storage|cleanup`：需要 host 分桶时使用 lockedHost…

**应改为（共识）：**

- `status|result|cancel`：**按 job UUID 解析路径**（可维护全局索引或扫描 state 树）；**不强制** host。  
- `status --all` 等列表类：可选 `--host` / `--target` 过滤。  
- `storage|cleanup`：可按 host/target/cwd 范围，与查单 job 分开写。

### I2 — README 示例过时

仍出现：

```bash
export AGENT_BRIDGE_HOST=codex
agent-bridge claude plan ...
```

与 v2「wrapper + LOCKED_HOST、裸 HOST 不够」冲突。应改为 `agent-bridge-codex claude plan ...`。

### I3 — §8.4「跨 Host 不共享 job 视图」vs UUID 查找

分目录仍可保留；UUID 全局可查 **不等于** 共享视图。补一句：

> 存储按 host/target 分桶；**查找**可按 UUID 跨桶定位，列表默认仅当前 host（若带 lock）或显式过滤。

### I4 — §11「Host lock 替代可伪造 HOST」措辞

易读成还在防伪造。改为「防 skill/发行面写错 host」即可。

### I5 — Codex `--ignore-user-config` 与禁精简

§9.2 嵌套硬化仍提 ignore-user-config。与 §3.4「不得砍登录」需一句边界：

> 仅当 **不破坏 auth** 且目的是隔离 bridge skills 时才允许；默认不启用；启用必须单测证明 login 仍可用。

### I6 — AGENTS「不要求改 PATH」vs 绝对路径

一致：绝对路径为主。可删「链到 bin 除外」的歧义，统一写 **skill 绝对路径**。

---

## 5. 实现风险（不是设计未定）

### IR1 — Codex L1 非交互（最高）

`approval never` 在 app-server 有据；**exec + 用户 on-request 配置** 是否可稳定覆盖，**未在本机钉死 argv**。  

**门禁：** Phase 2c 第一周必须产出可重复黄金 argv 或书面降级（L2 only / 提前 L3）。

### IR2 — Grok MCP + 零交互

文档明确 tools allowlist **不等于** 无 MCP。deny/sandbox/dontAsk 组合未测。  

**门禁：** Phase 2b WriteProbe + 超时无人工。

### IR3 — Claude rescue 写路径 permission-mode

plan 有 `dontAsk`；**write rescue 未写死 mode**。现网可能依赖默认。  

**风险：** 非交互下 Edit 被拒或异常。  

**建议：** §9.1 为 write 补一档「非交互可完成」的 mode（仍禁 bypass），并单测。

### IR4 — 双通道 install 与 marketplace 漂移

marketplace 插件与 `install --apply` 若生成 skill 路径/版本不一致会惨。  

**建议：** 单一 generator 输出到 hosts/*；两条通道只是入口。

### IR5 — Host 升权 / allow 命令

Codex escalated、Grok allow shell：文档有，skill 文案必须生成正确，否则用户只感觉「bridge 不能用」。属发行面质量，非架构。

### IR6 — 直接调 CLI 绕过 bridge

已知残余；NESTED + skill 文案；不靠 bare。可接受。

---

## 6. 安全与权限模型（终审）

| 控制 | 评价 |
|------|------|
| 发行面无 self | 扎实 |
| install 无 self | 扎实 |
| Runtime self | 扎实（装错场景） |
| 禁 bare | 扎实 |
| 执行零交互 | 产品正确；Codex/Grok 靠实测兑现 |
| 只读分级 | 诚实 |
| 不代登 | 正确 |
| 危险 bypass 默认关 | 正确 |
| env 继承密钥 | 仍仅警告；V1 可接受 |

**无过度安全臆想**（伪造 wrapper 已踢出范围）。

---

## 7. 分期可行性

| Phase | 依赖 | 风险 | 可否开 |
|-------|------|------|--------|
| 0 | I1–I6 小补丁更佳 | 低 | **可** |
| 1 Claude | 现网 | 低 | **可** |
| 2a Agy | isolation 抽取 | 中 | **可** |
| 2b Grok | IR2 | 高 | 可，严门禁 |
| 2c Codex L1/L2 | IR1 | 高 | 可，允许降级 |
| 3–4 Host 货架 | generator | 中 | 可 |
| 5 L3 | 可选 | 高 | 可选 |

---

## 8. 压力场景

| 场景 | 期望 | 设计 | 备注 |
|------|------|------|------|
| Codex→Claude plan | 零交互只读 | ✅ | 现网强 |
| Codex→Codex | 拒绝 | ✅ | |
| 装错 skill + 对 wrapper | 难 self | ✅ | |
| status 仅 UUID | 可查 | 共识 ✅ / 正文 I1 | 补文档 |
| 子 Claude 弹权限 | 不应 | §9.0 | 实现达标则 OK |
| 未 login | setup/委派 fail | ✅ | |
| Grok plan 有 MCP 写 | 应禁 | 📝 | 实测 |
| Codex 卡 approval | 不应 | 📝 | 实测 |
| rescue 默认写仓 | 不应 | ✅ | |
| bare | 禁 | ✅ | |

---

## 9. 结论

| 问题 | 答案 |
|------|------|
| 方案是否全面？ | **是**（目标、矩阵、分发、安全、差异、授权、分期） |
| 是否还要大改架构？ | **否** |
| 是否还有「瞎搞」级错误？ | 正文有几处 **未同步共识**（I1–I6），易修 |
| 最大真实风险？ | **Codex/Grok headless 零交互兑现** |
| **能否 Phase 0？** | **能。建议先改 I1/I2（及可选 I3–I6）再写代码，或 Phase 0 第一批 commit 就改。** |

### 推荐行动顺序

1. 小补丁 design/README/AGENTS（I1–I6）  
2. Phase 0：cli、lock、install、manifest、UUID job 索引骨架  
3. Phase 1 Claude…  

---

## 10. 实现者检查清单（开工用）

- [ ] 修 §6.2 status=UUID  
- [ ] 修 README 示例为 wrapper  
- [ ] 禁 bare 进 args 黑名单  
- [ ] lock + wrapper 生成 + 绝对路径 skill  
- [ ] 多 Host marketplace 空清单 + check-manifest 无 self  
- [ ] 门禁单测 self/nested/no-lock  
- [ ] job UUID + 按 id 查找  
- [ ] doctor 骨架  
- [ ] §9.0 行为不测真 LLM 也可测（fake 不弹窗）

---

**审查 v3 结束。批准：设计可冻结，进入实现；仅文档小同步 + 实测门禁。**
