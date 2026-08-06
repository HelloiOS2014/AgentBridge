import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EXIT } from "../src/core/exit-codes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.mjs");
const fakeClaude = path.join(root, "tests", "fixtures", "fake-claude.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

function baseEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-bg-"));
  return {
    AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
    AGENT_BRIDGE_HOME: home,
    AGENT_BRIDGE_CLAUDE_BIN: fakeClaude,
    AGENT_BRIDGE_LOCKED_HOST: "codex"
  };
}

function jobOf(env, jobId) {
  const r = run(["result", jobId, "--json"], env);
  assert.equal(r.status, EXIT.OK, r.stdout || r.stderr);
  return JSON.parse(r.stdout).job;
}

async function waitForStatus(env, jobId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = run(["result", jobId, "--json"], env);
    if (r.status === EXIT.OK) {
      const job = JSON.parse(r.stdout).job;
      if (job.status !== "running") {
        return job;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.fail(`job ${jobId} never left running`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("background workers", () => {
  it("background returns running immediately, record flips to completed after fake sleep", async () => {
    const env = baseEnv();
    env.FAKE_CLAUDE_SLEEP_MS = "1500";
    const r = run(["claude", "plan", "--background", "--json", "--prompt", "hello bg"], env);
    assert.equal(r.status, EXIT.OK);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "running");
    assert.ok(out.jobId);

    const running = jobOf(env, out.jobId);
    assert.equal(running.status, "running");
    assert.ok(Number.isInteger(running.pid));
    assert.equal(running.summary, "running");

    const done = await waitForStatus(env, out.jobId);
    assert.equal(done.status, "completed");
    assert.equal(done.jobId, out.jobId);
    assert.match(done.rendered ?? "", /hello bg/);
  });

  it("background --wait blocks and returns the completed record", async () => {
    const env = baseEnv();
    env.FAKE_CLAUDE_SLEEP_MS = "800";
    const r = run(["claude", "plan", "--background", "--wait", "--json", "--prompt", "wait me"], env);
    assert.equal(r.status, EXIT.OK);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "completed");
    assert.ok(out.jobId);
    assert.match(out.rendered ?? "", /wait me/);
  });

  it("background --wait times out via AGENT_BRIDGE_WAIT_TIMEOUT_MS", () => {
    const env = baseEnv();
    env.FAKE_CLAUDE_SLEEP_MS = "20000";
    env.AGENT_BRIDGE_WAIT_TIMEOUT_MS = "400";
    const r = run(["claude", "plan", "--background", "--wait", "--json", "--prompt", "slow"], env);
    assert.equal(r.status, EXIT.FAIL);
    const out = JSON.parse(r.stdout);
    assert.equal(out.errorCode, "wait_timeout");
    // 清理孤儿 worker（仍在 running，有 pid 可 cancel）；cancel 输出轻量，记录状态从 result 读
    const c = run(["cancel", out.jobId, "--json"], env);
    assert.equal(c.status, EXIT.OK);
    assert.equal(jobOf(env, out.jobId).status, "cancelled");
  });

  it("cancel terminates a long background job and keeps the record cancelled", async () => {
    const env = baseEnv();
    env.FAKE_CLAUDE_SLEEP_MS = "20000";
    const r = run(["claude", "plan", "--background", "--json", "--prompt", "long task"], env);
    assert.equal(r.status, EXIT.OK);
    const jobId = JSON.parse(r.stdout).jobId;

    assert.equal(jobOf(env, jobId).status, "running");
    const c = run(["cancel", jobId, "--json"], env);
    assert.equal(c.status, EXIT.OK);
    assert.match(JSON.parse(c.stdout).summary, /cancelled/);
    const cancelled = jobOf(env, jobId);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.cancelledAt);

    // worker 进程组已被杀：记录不会再被覆盖成 completed
    await sleep(1200);
    assert.equal(jobOf(env, jobId).status, "cancelled");

    // 重复 cancel → no-op
    const again = run(["cancel", jobId, "--json"], env);
    assert.equal(again.status, EXIT.OK);
    assert.match(JSON.parse(again.stdout).summary, /already cancelled/);
  });

  it("--worker runs the delegation and persists under the given jobId", () => {
    const env = baseEnv();
    const jobId = crypto.randomUUID();
    const r = run(["claude", "plan", "--worker", jobId, "--json", "--prompt", "worker direct"], env);
    assert.equal(r.status, EXIT.OK);
    const out = JSON.parse(r.stdout);
    assert.equal(out.jobId, jobId);
    const job = jobOf(env, jobId);
    assert.equal(job.status, "completed");
    assert.match(job.rendered ?? "", /worker direct/);
  });

  it("cancel on a completed job is a no-op", () => {
    const env = baseEnv();
    const r = run(["claude", "plan", "--json", "--prompt", "quick"], env);
    assert.equal(r.status, EXIT.OK);
    const jobId = JSON.parse(r.stdout).jobId;
    assert.equal(jobOf(env, jobId).status, "completed");
    const c = run(["cancel", jobId, "--json"], env);
    assert.equal(c.status, EXIT.OK);
    assert.match(JSON.parse(c.stdout).summary, /already completed/);
  });
});
