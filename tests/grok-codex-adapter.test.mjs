import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCodexArgs, runCodex, setup as setupCodex } from "../src/adapters/codex.mjs";
import { buildGrokArgs, runGrok, setup as setupGrok } from "../src/adapters/grok.mjs";
import { runDelegation } from "../src/core/run.mjs";
import { assertNoForbiddenFlags } from "../src/core/safety.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const fakeGrok = path.join(root, "fixtures/fake-grok.mjs");
const fakeCodex = path.join(root, "fixtures/fake-codex.mjs");

describe("grok adapter", () => {
  it("read-only argv has sandbox and no yolo", () => {
    const args = buildGrokArgs({ kind: "plan", prompt: "hi", write: false });
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("read-only"));
    assert.ok(args.includes("dontAsk"));
    assert.ok(args.includes("Agent"));
    assert.doesNotThrow(() => assertNoForbiddenFlags(args));
  });

  it("write argv grants edit+shell tools and allow rules (no headless auto-deny)", () => {
    const args = buildGrokArgs({ kind: "rescue", prompt: "fix", write: true });
    const toolsIdx = args.indexOf("--tools");
    assert.ok(toolsIdx >= 0);
    const tools = args[toolsIdx + 1].split(",");
    for (const t of ["read_file", "grep", "list_dir", "search_replace", "run_terminal_command"]) {
      assert.ok(tools.includes(t), `missing tool ${t}`);
    }
    assert.ok(args.includes("dontAsk")); // dontAsk = 严格 allowlist（acceptEdits 只批编辑，terminal 被拒）
    assert.ok(args.includes("--deny"));
    // headless 免审批：Edit/Write/Bash allow 规则（acceptEdits 对 terminal 仍会被自动取消）
    assert.ok(args.includes("Edit(**)"));
    assert.ok(args.includes("Write(**)"));
    assert.ok(args.includes("Bash(*)"));
    assert.doesNotThrow(() => assertNoForbiddenFlags(args));
  });

  it("setup + plan with fake", async () => {
    const env = { ...process.env, AGENT_BRIDGE_GROK_BIN: fakeGrok };
    const s = await setupGrok({ env });
    assert.equal(s.ready, true);
    const r = await runGrok({
      kind: "plan",
      prompt: "plan api",
      cwd: process.cwd(),
      env
    });
    assert.equal(r.ok, true);
    assert.match(r.output, /Fake Grok/);
  });

  it("runDelegation grok", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-grok-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const result = await runDelegation({
      host: "codex",
      target: "grok",
      command: "plan",
      prompt: "rate limit",
      env: {
        ...process.env,
        AGENT_BRIDGE_HOME: home,
        AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
        AGENT_BRIDGE_GROK_BIN: fakeGrok
      }
    });
    assert.equal(result.status, "completed");
    assert.equal(result.target, "grok");
  });
});

describe("codex adapter", () => {
  it("L1 plan args: read-only + approval never, no dangerous", () => {
    const args = buildCodexArgs({
      kind: "plan",
      prompt: "hello",
      cwd: "/tmp/proj",
      write: false
    });
    assert.ok(args.includes("exec"));
    assert.ok(args.includes("read-only"));
    assert.ok(args.some((a) => String(a).includes("approval_policy")));
    assert.ok(!args.some((a) => String(a).includes("dangerously-bypass")));
  });

  it("L2 review args", () => {
    const args = buildCodexArgs({
      kind: "review",
      prompt: "focus auth",
      cwd: "/tmp/proj"
    });
    assert.ok(args.includes("review"));
    assert.ok(args.includes("--uncommitted"));
  });

  it("attachments become -i image flags; prompt omitted from argv (stdin)", () => {
    const args = buildCodexArgs({
      kind: "plan",
      prompt: "analyze",
      cwd: "/tmp/proj",
      attachments: [{ placedPath: "/tmp/proj/agent-bridge-attach-0-img.jpeg", originalPath: "/x/img.jpeg" }]
    });
    const iIdx = args.indexOf("-i");
    assert.ok(iIdx >= 0);
    assert.equal(args[iIdx + 1], "/tmp/proj/agent-bridge-attach-0-img.jpeg");
    assert.ok(!args.includes("analyze"), "prompt 不再作为位置参数（走 stdin）");
  });

  it("setup + plan with fake", async () => {
    const env = { ...process.env, AGENT_BRIDGE_CODEX_BIN: fakeCodex };
    const s = await setupCodex({ env });
    assert.equal(s.ready, true);
    const r = await runCodex({
      kind: "plan",
      prompt: "plan db",
      cwd: process.cwd(),
      env
    });
    assert.equal(r.ok, true);
    assert.match(r.output, /Fake Codex/);
    assert.equal(r.transport, "exec");
  });

  it("runDelegation codex review", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-codex-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const result = await runDelegation({
      host: "claude",
      target: "codex",
      command: "review",
      prompt: "security",
      env: {
        ...process.env,
        AGENT_BRIDGE_HOME: home,
        AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
        AGENT_BRIDGE_CODEX_BIN: fakeCodex
      }
    });
    assert.equal(result.status, "completed");
    assert.equal(result.metadata.codexTransport, "exec-review");
  });
});
