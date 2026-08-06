import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
function makeEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-trunc-"));
  return {
    AGENT_BRIDGE_HOME: home,
    AGENT_BRIDGE_STATE_DIR: path.join(home, "state"),
    AGENT_BRIDGE_CLAUDE_BIN: fakeClaude,
    AGENT_BRIDGE_LOCKED_HOST: "codex"
  };
}
function findJobFile(env, jobId) {
  const stack = [env.AGENT_BRIDGE_STATE_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile() && entry.name === `${jobId}.json`) {
        return p;
      }
    }
  }
  return null;
}

const BIG = "x".repeat(20 * 1024); // rendered > 16KB 默认阈值

describe("display-layer truncation (T1.1)", () => {
  it("delegation return truncates rendered; disk job file stays full", () => {
    const env = makeEnv();
    const r = run(["claude", "plan", "--json", "--prompt", BIG], env);
    assert.equal(r.status, EXIT.OK);
    const j = JSON.parse(r.stdout);
    assert.equal(j.status, "completed");
    assert.ok(Buffer.byteLength(j.rendered, "utf8") <= 16 * 1024, "rendered truncated on return");
    assert.equal(j.metadata.storage.truncated, true);
    assert.deepEqual(j.metadata.storage.truncatedFields, ["rendered"]);
    assert.ok(j.metadata.storage.omittedBytes > 0);

    const jobFile = findJobFile(env, j.jobId);
    assert.ok(jobFile, "job file exists");
    const disk = JSON.parse(fs.readFileSync(jobFile, "utf8"));
    assert.ok(Buffer.byteLength(disk.rendered, "utf8") > 16 * 1024, "disk job file is full");
    assert.equal(disk.metadata.storage.truncated, false);
  });

  it("result truncates; result --full returns full text", () => {
    const env = makeEnv();
    const r = run(["claude", "plan", "--json", "--prompt", BIG], env);
    const j = JSON.parse(r.stdout);
    const res = run(["result", j.jobId, "--json"], env);
    assert.equal(res.status, EXIT.OK);
    const rj = JSON.parse(res.stdout);
    assert.ok(Buffer.byteLength(rj.job.rendered, "utf8") <= 16 * 1024);
    assert.equal(rj.job.metadata.storage.truncated, true);

    const full = run(["result", j.jobId, "--full", "--json"], env);
    assert.equal(full.status, EXIT.OK);
    const fj = JSON.parse(full.stdout);
    assert.ok(Buffer.byteLength(fj.job.rendered, "utf8") > 16 * 1024, "--full skips truncation");
    assert.equal(fj.job.metadata.storage.truncated, false);
  });

  it("below-threshold output unchanged", () => {
    const env = makeEnv();
    const r = run(["claude", "plan", "--json", "--prompt", "short prompt"], env);
    assert.equal(r.status, EXIT.OK);
    const j = JSON.parse(r.stdout);
    assert.equal(j.metadata.storage.truncated, false);
    assert.deepEqual(j.metadata.storage.truncatedFields, []);
    assert.equal(j.metadata.storage.omittedBytes, 0);
    assert.match(j.rendered, /short prompt/);
  });

  it("env limits override defaults (render + raw)", () => {
    const env = makeEnv();
    env.AGENT_BRIDGE_RENDER_LIMIT_KB = "1";
    env.AGENT_BRIDGE_RAW_LIMIT_KB = "1";
    const r = run(["claude", "plan", "--json", "--prompt", BIG], env);
    assert.equal(r.status, EXIT.OK);
    const j = JSON.parse(r.stdout);
    assert.ok(Buffer.byteLength(j.rendered, "utf8") <= 1024, "render limit honored");
    assert.ok(Buffer.byteLength(j.rawOutput, "utf8") <= 1024, "raw limit honored");
    assert.deepEqual(j.metadata.storage.truncatedFields.sort(), ["rawOutput", "rendered"]);
  });
});
