# Agent Instructions

本仓库实现 **AgentBridge**：跨 Codex / Claude Code / Grok Build 的本机多 agent 委派桥。

**设计真源：`docs/design.md`（v2）。**  
实现前必读：§3 Host lock / self、§5 分发、§8.5 只读分级、§9 Target 黄金路径。  
附录：`docs/agent-differences.md`、`docs/reference-codex-plugin-cc.md`、`docs/design-review.md`（历史审查）。

## 硬约束（不可违反）

1. **禁止 self-delegation**
   - `hosts/codex/` 无 codex-bridge；`hosts/claude/` 无 claude-bridge；`hosts/grok/` 无 grok-bridge。
   - `install --host X` 的 targets ⊆ `all \ {X}`；含 self 失败。

2. **Host lock（v2）**
   - Skills **只**调用 `agent-bridge-<host>` wrapper（或等价 locked 调用）。
   - 委派类命令无 lock → 失败；不信任单独可伪造的 `AGENT_BRIDGE_HOST`。
   - `target === lockedHost` → exit 3；`NESTED=1` → exit 4。
   - `ALLOW_SELF` / `ALLOW_UNSCOPED` 仅测试/调试，不进用户主文档。

3. **CLI-only（第一期）**
   - 不在 plugin 清单加 MCP 作为核心路径。
   - **生产路径 = marketplace 插件自足**：插件打包完整引擎（`src/`），skill 首用自举到 `~/.agent-bridge/engine/` 与 `~/.agent-bridge/bin/agent-bridge-<host>`（幂等、版本防漂移、机器级唯一引擎）；npm / `npm link` 不是前提；`agent-bridge install` 是补充通道（自动化/批量），不替代 marketplace。
   - 改引擎后必须重跑 `node scripts/generate-skills.mjs`（插件内 `src/` 副本由 check-manifest 强制与根一致）。

4. **权限**
   - plan/review/adversarial-review 只读 + WriteProbe（或 capabilities 标明 best-effort）。
   - **rescue 默认只读**；仅用户明确写意图时 skill 加 `--write`（**不要**照搬 codex-plugin-cc 默认写）。
   - 危险 bypass / 无 harden 的 yolo 禁止；`spawn(argv[])`。

4b. **铁律：禁止精简 / bare / minimal**
   - **任何 Target、任何 Kind、含嵌套防环，都不得**使用 Claude `--bare`、`--safe-mode` 或其它 agent 的「精简会话」类开关。
   - 防嵌套只用 NESTED、skill 约束、tool/sandbox/isolation 等 **不破坏正常登录与默认运行时** 的手段。

5. **Target 规范**
   - 改调用方式先改 `design.md` §9 与 argv 单测。
   - Codex：L1 exec → L2 exec review → L3 app-server 分期；主路径不用 dangerously-bypass。
   - Grok 只读必须处理 MCP 残留（见 design §9.3）。
   - Antigravity 只读保留 isolation+probe；**永不传 `--model`**（print 模式坏路，实测 5 种取值形式均复现）；prompt 必须是 `-p` 的值（取值型 flag，放 `--` 后或其它 flag 之后会被吞）。

6. **状态**
   - `$STATE/<host>/<target>/<workspace-hash>/`；不自动 commit/push。

7. **发行面**
   - `npm run check:manifest`；一 Target 一 bridge 包；断言插件含 src/cli.mjs + wrapper + 自举段 + **插件内 src 与根 src 一致性**（文件清单 + sha256）。

## 实现偏好

- Node ESM ≥ 18.18；优先零运行时依赖。
- 从 codex-agent-bridge 抽 Core；Codex Target 参考 codex-plugin-cc **协议与 approval/sandbox，不抄产品默认写**。
- Host 差异只在 `hosts/*`；skill 模板生成。
- Bin 发现 + `AGENT_BRIDGE_<TARGET>_BIN`；skill 使用 wrapper **绝对路径**，不依赖用户改 PATH。
- `status|result|cancel` 按 job **UUID** 查找，不强制 host。

## 验证（实现后）

```bash
npm test
npm run check:manifest
git diff --check
```

真实 CLI smoke 可选；默认单测用 `tests/fixtures/fake-*.mjs`。
