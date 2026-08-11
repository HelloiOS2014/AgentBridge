import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { listJobs, lookupJob, newJobId, registerJob } from "../src/core/jobs.mjs";
import { runDelegation } from "../src/core/run.mjs";

const fakeClaude = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-claude.mjs");

describe("runDelegation claude", () => {
  it("plan completes with fake claude and host lock env", async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-run-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const env = {
      ...process.env,
      AGENT_BRIDGE_HOME: home,
      AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
      AGENT_BRIDGE_CLAUDE_BIN: fakeClaude,
      AGENT_BRIDGE_LOCKED_HOST: "codex"
    };
    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "plan",
      prompt: "design rate limiter",
      cwd: process.cwd(),
      env
    });
    assert.equal(result.status, "completed");
    assert.equal(result.target, "claude");
    assert.match(result.rendered, /rate limiter/);
    assert.ok(result.jobId);
  });

  it("setup works", async () => {
    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "setup",
      env: {
        ...process.env,
        AGENT_BRIDGE_CLAUDE_BIN: fakeClaude
      }
    });
    assert.equal(result.status, "completed");
    assert.equal(result.ready, true);
  });

  it("delegation prunes expired jobs opportunistically (T1.4)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-run-"));
    const env = {
      ...process.env,
      AGENT_BRIDGE_HOME: home,
      AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
      AGENT_BRIDGE_CLAUDE_BIN: fakeClaude,
      AGENT_BRIDGE_LOCKED_HOST: "codex"
    };
    const oldId = newJobId();
    const oldFile = path.join(env.AGENT_BRIDGE_STATE_DIR, "codex", "claude", "ws", "jobs", `${oldId}.json`);
    fs.mkdirSync(path.dirname(oldFile), { recursive: true });
    fs.writeFileSync(oldFile, JSON.stringify({ id: oldId, status: "completed", kind: "plan", summary: "old" }, null, 2), "utf8");
    registerJob({ id: oldId, host: "codex", target: "claude", workspaceHash: "ws", jobFile: oldFile, env });
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, old, old);

    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "plan",
      prompt: "design rate limiter",
      cwd: process.cwd(),
      env
    });
    assert.equal(result.status, "completed");
    assert.equal(fs.existsSync(oldFile), false, "10-day-old job pruned");
    assert.equal(lookupJob(oldId, env), null, "index has no orphan");
    const jobs = listJobs(env);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].jobId, result.jobId, "new job kept");
  });

});

describe("write task output detection", () => {
  it("rescue --write with zero workspace change is flagged no_output", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-noout-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-noout-ws-"));
    spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir, encoding: "utf8" });

    const result = await runDelegation({
      host: "codex",
      target: "claude",
      command: "rescue",
      write: true,
      prompt: "fix something",
      cwd: dir,
      env: {
        ...process.env,
        AGENT_BRIDGE_HOME: home,
        AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
        AGENT_BRIDGE_CLAUDE_BIN: fakeClaude
      }
    });
    // fake claude 不产生任何文件变化 → 零产出应被如实标记
    assert.equal(result.noOutput, true);
    assert.equal(result.errorCode, "no_output");
    assert.match(result.summary, /零产出/);
  });
});
