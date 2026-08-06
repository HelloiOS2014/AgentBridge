import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildAgyArgs, runAntigravity, setup } from "../src/adapters/antigravity.mjs";
import { runDelegation } from "../src/core/run.mjs";

const fakeAgy = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-agy.mjs");

describe("antigravity adapter", () => {
  it("buildAgyArgs sandbox for read, not for write", () => {
    const readArgs = buildAgyArgs({ write: false, prompt: "hi" });
    assert.ok(readArgs.includes("--sandbox"));
    assert.ok(readArgs.includes("-p"));
    const writeArgs = buildAgyArgs({ write: true, prompt: "hi" });
    assert.ok(!writeArgs.includes("--sandbox"));
  });

  it("buildAgyArgs ignores model (user decision; modelIgnored)", () => {
    const args = buildAgyArgs({ model: "gemini-3.6-flash-high", write: false, prompt: "hi" });
    assert.ok(!args.includes("--model"));
  });

  it("setup ready with fake agy", async () => {
    const s = await setup({
      env: { ...process.env, AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy }
    });
    assert.equal(s.ready, true);
  });

  it("plan with isolation + fake agy", async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-ws-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
      cwd: dir,
      encoding: "utf8"
    });

    const result = await runAntigravity({
      kind: "plan",
      prompt: "plan something",
      cwd: dir,
      env: { ...process.env, AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy }
    });
    assert.equal(result.ok, true);
    assert.match(result.output, /Fake Agy/);
    assert.ok(result.args.includes("--sandbox"));
    assert.deepEqual(result.touchedFiles, []);
  });

  it("isolation probe fails when agy touches files", async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-touch-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
      cwd: dir,
      encoding: "utf8"
    });

    const result = await runAntigravity({
      kind: "plan",
      prompt: "touch",
      cwd: dir,
      env: {
        ...process.env,
        AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy,
        FAKE_AGY_TOUCH: "evil.txt"
      }
    });
    assert.equal(result.ok, false);
    assert.ok(result.touchedFiles.some((f) => f.includes("evil") || f === "evil.txt"));
  });

  it("rescue --write runs in a git worktree; main workspace untouched", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-wt-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-write-"));
    spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], {
      cwd: dir,
      encoding: "utf8"
    });

    let worktreePath = null;
    try {
      const result = await runDelegation({
        host: "codex",
        target: "antigravity",
        command: "rescue",
        prompt: "fix the bug",
        write: true,
        cwd: dir,
        env: {
          ...process.env,
          AGENT_BRIDGE_HOME: home,
          AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
          AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy,
          FAKE_AGY_TOUCH: "fixed.txt"
        }
      });
      assert.equal(result.status, "completed");
      assert.ok(result.worktree, "worktree must be reported in the result");
      assert.match(result.worktree.branch, /^agent-bridge-write-\d+$/);
      worktreePath = result.worktree.path;
      assert.ok(fs.existsSync(path.join(worktreePath, "fixed.txt")), "write lands in the worktree");
      assert.ok(!fs.existsSync(path.join(dir, "fixed.txt")), "main workspace untouched");
      assert.ok(result.touchedFiles.includes("fixed.txt"));
      assert.equal(result.metadata.isolation.antigravityWorktree.worktreePath, worktreePath);
      const status = spawnSync("git", ["status", "--short"], { cwd: dir, encoding: "utf8" });
      assert.equal(status.stdout.trim(), "", "main repo git status stays clean");
    } finally {
      if (worktreePath) {
        spawnSync("git", ["worktree", "remove", "--force", worktreePath], { cwd: dir, encoding: "utf8" });
        fs.rmSync(path.dirname(worktreePath), { recursive: true, force: true });
      }
    }
  });

  it("rescue --write falls back to direct run outside a git repo", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-wt2-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-write-nogit-"));
    const result = await runDelegation({
      host: "codex",
      target: "antigravity",
      command: "rescue",
      prompt: "fix the bug",
      write: true,
      cwd: dir,
      env: {
        ...process.env,
        AGENT_BRIDGE_HOME: home,
        AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
        AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy,
        FAKE_AGY_TOUCH: "fixed.txt"
      }
    });
    assert.equal(result.status, "completed");
    assert.equal(result.worktree, null);
    assert.ok(fs.existsSync(path.join(dir, "fixed.txt")), "write lands in the real dir on fallback");
  });

  it("runDelegation antigravity plan", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-agy-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-del-"));
    t.after(() => {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    });
    spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
      cwd: dir,
      encoding: "utf8"
    });

    const result = await runDelegation({
      host: "codex",
      target: "antigravity",
      command: "plan",
      prompt: "architecture",
      cwd: dir,
      env: {
        ...process.env,
        AGENT_BRIDGE_HOME: home,
        AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
        AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy
      }
    });
    assert.equal(result.status, "completed");
    assert.equal(result.target, "antigravity");
    assert.equal(result.metadata.readOnlyLevel, "isolation+probe");
  });
});

describe("agy headless argv (official docs)", () => {
  it("prompt is the -p value, no -- separator", () => {
    const args = buildAgyArgs({ prompt: "hi" });
    assert.equal(args[0], "-p");
    assert.equal(args[1], "hi");
    assert.ok(!args.includes("--"));
  });

  it("always emits --output-format json", () => {
    const args = buildAgyArgs({ prompt: "hi" });
    assert.ok(args.includes("--output-format"));
    assert.equal(args[args.indexOf("--output-format") + 1], "json");
  });

  it("--mode plan only for kind plan", () => {
    assert.ok(buildAgyArgs({ kind: "plan", prompt: "hi" }).includes("--mode"));
    assert.ok(!buildAgyArgs({ kind: "review", prompt: "hi" }).includes("--mode"));
    assert.ok(!buildAgyArgs({ kind: "rescue", prompt: "hi" }).includes("--mode"));
    assert.ok(!buildAgyArgs({ kind: "adversarial-review", prompt: "hi" }).includes("--mode"));
    assert.ok(!buildAgyArgs({ prompt: "hi" }).includes("--mode"));
  });

  it("--print-timeout defaults to 15m, explicit value passes through", () => {
    const args = buildAgyArgs({ prompt: "hi" });
    const i = args.indexOf("--print-timeout");
    assert.ok(i >= 0, "--print-timeout missing from args");
    assert.equal(args[i + 1], "15m");
    const custom = buildAgyArgs({ printTimeout: "30m", prompt: "hi" });
    assert.equal(custom[custom.indexOf("--print-timeout") + 1], "30m");
  });
});

describe("agy json envelope parsing", () => {
  function makeGitDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-enc-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], { cwd: dir, encoding: "utf8" });
    return dir;
  }

  it("extracts response from envelope and reports usage", async (t) => {
    const dir = makeGitDir(t);
    const result = await runAntigravity({
      kind: "plan",
      prompt: "plan something",
      cwd: dir,
      env: { ...process.env, AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy }
    });
    assert.equal(result.ok, true);
    assert.match(result.output, /Fake Agy response/);
    assert.ok(result.args.includes("--mode")); // plan kind
    assert.equal(result.sessionId, "fake-agy-conversation");
    assert.deepEqual(result.usage, { input_tokens: 1, output_tokens: 1 });
  });

  it("write path parses envelope and reports usage", async (t) => {
    const dir = makeGitDir(t);
    const result = await runAntigravity({
      kind: "plan",
      write: true,
      prompt: "write something",
      cwd: dir,
      env: { ...process.env, AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy }
    });
    assert.equal(result.ok, true);
    assert.match(result.output, /Fake Agy response/);
    assert.equal(result.sessionId, "fake-agy-conversation");
    assert.deepEqual(result.usage, { input_tokens: 1, output_tokens: 1 });
    assert.equal(result.isolation, null);
    assert.deepEqual(result.touchedFiles, []);
    assert.ok(!result.args.includes("--sandbox"));
  });

  it("write path surfaces envelopeError", async (t) => {
    const dir = makeGitDir(t);
    const result = await runAntigravity({
      write: true,
      prompt: "write",
      cwd: dir,
      env: { ...process.env, AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy, FAKE_AGY_ERROR: "1" }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /fake agy error envelope/);
    assert.equal(result.sessionId, "fake-agy-conversation");
  });

  it("kind plan and timeoutMs flow into argv", async (t) => {
    const dir = makeGitDir(t);
    const result = await runAntigravity({
      kind: "plan",
      prompt: "plan something",
      cwd: dir,
      timeoutMs: 30 * 60 * 1000,
      env: { ...process.env, AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy }
    });
    assert.ok(result.args.includes("--mode"));
    assert.equal(result.args[result.args.indexOf("--print-timeout") + 1], "30m");
  });

  it("envelope ERROR with error text fails with errorMessage", async (t) => {
    const dir = makeGitDir(t);
    const result = await runAntigravity({
      kind: "review",
      prompt: "review",
      cwd: dir,
      env: { ...process.env, AGENT_BRIDGE_ANTIGRAVITY_BIN: fakeAgy, FAKE_AGY_ERROR: "1" }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /fake agy error envelope/);
  });
});
