import antigravity from "./antigravity.mjs";
import claude from "./claude.mjs";
import codex from "./codex.mjs";
import grok from "./grok.mjs";

/** key = target id（与 src/core/ids.mjs 的 TARGET_IDS 对齐） */
export const ADAPTERS = Object.freeze({ claude, antigravity, grok, codex });

/** 统一运行入口：目标 agent 的 headless 调用。 */
export const RUNNERS = Object.freeze({
  claude: (req) => claude.runClaude(req),
  antigravity: (req) => antigravity.runAntigravity(req),
  grok: (req) => grok.runGrok(req),
  codex: (req) => codex.runCodex(req)
});
