import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildClaudeArgs,
  capabilities,
  runClaude,
  setup,
  toolProfileForKind
} from "../src/adapters/claude.mjs";
import { assertNoForbiddenFlags } from "../src/core/safety.mjs";

const fakeClaude = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-claude.mjs");

describe("claude adapter", () => {
  it("tool profiles", () => {
    assert.equal(toolProfileForKind({ kind: "plan" }), "read");
    assert.equal(toolProfileForKind({ kind: "review" }), "none");
    assert.equal(toolProfileForKind({ kind: "rescue", write: true }), "write");
  });

  it("buildClaudeArgs uses dontAsk and forbids bare", () => {
    const args = buildClaudeArgs({ kind: "plan", toolProfile: "read" });
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("dontAsk"));
    assert.ok(args.includes("Read,Glob,Grep"));
    assert.doesNotThrow(() => assertNoForbiddenFlags(args));
    assert.throws(() => assertNoForbiddenFlags([...args, "--bare"]));
  });

  it("write rescue uses acceptEdits (dontAsk auto-denies Write tools)", () => {
    const args = buildClaudeArgs({ kind: "rescue", write: true });
    const modeIdx = args.indexOf("--permission-mode");
    assert.ok(modeIdx >= 0);
    assert.equal(args[modeIdx + 1], "acceptEdits");
    assert.ok(args.includes("Edit,MultiEdit,Write"));
    const readRescue = buildClaudeArgs({ kind: "rescue" });
    assert.ok(readRescue.includes("dontAsk"));
  });

  it("setup with fake claude is ready", async () => {
    const status = await setup({
      env: { ...process.env, AGENT_BRIDGE_CLAUDE_BIN: fakeClaude },
      timeoutMs: 5000
    });
    assert.equal(status.ready, true);
    assert.equal(status.auth.loggedIn, true);
  });

  it("runClaude plan with fake", async () => {
    const result = await runClaude({
      kind: "plan",
      prompt: "plan a cache layer",
      cwd: process.cwd(),
      env: { ...process.env, AGENT_BRIDGE_CLAUDE_BIN: fakeClaude }
    });
    assert.equal(result.ok, true);
    assert.match(result.output, /Fake Claude response/);
    assert.equal(result.sessionId, "fake-claude-session");
    assert.ok(result.args.includes("--permission-mode"));
  });

  it("capabilities", () => {
    const c = capabilities();
    assert.equal(c.readOnlyGuarantee, "tool-profile");
    assert.equal(c.headlessZeroInteractive, true);
  });
});
