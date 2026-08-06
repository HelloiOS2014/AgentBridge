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

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}
function makeEnv(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-cli-"));
  t?.after?.(() => fs.rmSync(home, { recursive: true, force: true }));
  return { AGENT_BRIDGE_STATE_DIR: path.join(home, "state"), AGENT_BRIDGE_HOME: home };
}
function seedJob(env, host, target, ws, id) {
  const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, host, target, ws, "jobs", `${id}.json`);
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  fs.writeFileSync(jobFile, JSON.stringify({ id, status: "completed", kind: "plan", summary: "s", host, target }, null, 2), "utf8");
  return jobFile;
}

describe("cli surface", () => {
  it("status finds job via scan without index", (t) => {
    const env = makeEnv(t);
    const id = crypto.randomUUID();
    seedJob(env, "codex", "claude", "ws", id);
    const r = run(["status", id, "--json"], env);
    assert.equal(r.status, EXIT.OK);
    const j = JSON.parse(r.stdout);
    assert.equal(j.jobId, id);
    assert.equal(j.status, "completed"); // job status, not envelope
  });

  it("status is lightweight (no rendered/rawOutput/job)", () => {
    const env = makeEnv();
    const id = crypto.randomUUID();
    const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, "codex", "claude", "ws", "jobs", `${id}.json`);
    fs.mkdirSync(path.dirname(jobFile), { recursive: true });
    fs.writeFileSync(
      jobFile,
      JSON.stringify({ id, status: "failed", kind: "review", summary: "s", host: "codex", target: "claude", rendered: "R".repeat(100), rawOutput: "O".repeat(100), completedAt: "2026-01-01T00:00:00.000Z" }, null, 2),
      "utf8"
    );
    const r = run(["status", id, "--json"], env);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(j).sort(), ["completedAt", "host", "jobId", "kind", "status", "summary", "target"]);
    assert.equal(j.rendered, undefined);
    assert.equal(j.rawOutput, undefined);
    assert.equal(j.job, undefined);
  });

  it("result returns full job structure", () => {
    const env = makeEnv();
    const id = crypto.randomUUID();
    const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, "codex", "claude", "ws", "jobs", `${id}.json`);
    fs.mkdirSync(path.dirname(jobFile), { recursive: true });
    fs.writeFileSync(
      jobFile,
      JSON.stringify({ id, status: "completed", kind: "plan", summary: "s", host: "codex", target: "claude", rendered: "R".repeat(100), rawOutput: "O".repeat(100) }, null, 2),
      "utf8"
    );
    const r = run(["result", id, "--json"], env);
    const j = JSON.parse(r.stdout);
    assert.equal(j.kind, "result");
    assert.equal(j.job.id, id);
    assert.equal(j.job.rendered, "R".repeat(100));
  });

  it("cancel is lightweight", () => {
    const env = makeEnv();
    const id = crypto.randomUUID();
    seedJob(env, "codex", "claude", "ws", id);
    const r = run(["cancel", id, "--json"], env);
    assert.equal(r.status, EXIT.OK);
    const j = JSON.parse(r.stdout);
    assert.equal(j.jobId, id);
    assert.equal(j.job, undefined);
    assert.equal(j.rendered, undefined);
  });

  it("status --all lists jobs with filters", (t) => {
    const env = makeEnv(t);
    seedJob(env, "codex", "claude", "ws", crypto.randomUUID());
    seedJob(env, "codex", "grok", "ws", crypto.randomUUID());
    const all = run(["status", "--all", "--json"], env);
    assert.equal(JSON.parse(all.stdout).count, 2);
    const filtered = run(["status", "--all", "--target", "grok", "--json"], env);
    const jobs = JSON.parse(filtered.stdout).jobs;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].target, "grok");
  });

  it("storage reports state root", (t) => {
    const env = makeEnv(t);
    seedJob(env, "codex", "claude", "ws", crypto.randomUUID());
    const r = run(["storage", "--json"], env);
    assert.equal(r.status, EXIT.OK);
    const j = JSON.parse(r.stdout);
    assert.equal(j.jobCount, 1);
    assert.equal(j.stateRoot, env.AGENT_BRIDGE_STATE_DIR);
  });

  it("cleanup without scope exits 2", (t) => {
    const env = makeEnv(t);
    const r = run(["cleanup", "--json"], env);
    assert.equal(r.status, EXIT.USAGE);
  });

  it("cleanup --all deletes jobs", (t) => {
    const env = makeEnv(t);
    seedJob(env, "codex", "claude", "ws", crypto.randomUUID());
    const r = run(["cleanup", "--all", "--json"], env);
    assert.equal(r.status, EXIT.OK);
    assert.equal(JSON.parse(r.stdout).deleted, 1);
    const after = run(["status", "--all", "--json"], env);
    assert.equal(JSON.parse(after.stdout).count, 0);
  });

  it("cleanup --target nonsense exits 2", (t) => {
    const env = makeEnv(t);
    const r = run(["cleanup", "--target", "nonsense", "--json"], env);
    assert.equal(r.status, EXIT.USAGE);
    assert.equal(JSON.parse(r.stdout).errorCode, "usage");
  });

  it("status --all --target nonsense exits 2", (t) => {
    const env = makeEnv(t);
    const r = run(["status", "--all", "--target", "nonsense", "--json"], env);
    assert.equal(r.status, EXIT.USAGE);
    assert.equal(JSON.parse(r.stdout).errorCode, "usage");
  });

  it("cleanup --host only deletes that host's jobs", (t) => {
    const env = makeEnv(t);
    seedJob(env, "codex", "claude", "ws", crypto.randomUUID());
    seedJob(env, "claude", "grok", "ws", crypto.randomUUID());
    const r = run(["cleanup", "--host", "codex", "--json"], env);
    assert.equal(r.status, EXIT.OK);
    assert.equal(JSON.parse(r.stdout).deleted, 1);
    const after = run(["status", "--all", "--json"], env);
    assert.equal(JSON.parse(after.stdout).count, 1);
  });

  it("install --remove uninstalls host", (t) => {
    const env = makeEnv(t);
    env.HOME = env.AGENT_BRIDGE_HOME;
    const home = env.AGENT_BRIDGE_HOME;
    const inst = run(["install", "--host", "codex", "--targets", "claude", "--apply", "--json"], env);
    assert.equal(inst.status, EXIT.OK);
    const rem = run(["install", "--host", "codex", "--remove", "--json"], env);
    assert.equal(rem.status, EXIT.OK);
    const r = JSON.parse(rem.stdout);
    assert.ok(r.removed.length >= 2); // wrapper + lock（PATH 链接可能不存在）
    assert.equal(fs.existsSync(path.join(home, "hosts", "codex.lock.json")), false);
    assert.equal(fs.existsSync(path.join(home, "bin", "agent-bridge-codex")), false);
  });

  it("install --remove <target> keeps host, removes only that target's skills", (t) => {
    const env = makeEnv(t);
    env.HOME = env.AGENT_BRIDGE_HOME;
    const inst = run(["install", "--host", "codex", "--targets", "claude,grok", "--apply", "--json"], env);
    assert.equal(inst.status, EXIT.OK);
    const rem = run(["install", "--host", "codex", "--remove", "grok", "--json"], env);
    assert.equal(rem.status, EXIT.OK);
    const skillsRoot = path.join(env.HOME, ".agent-bridge", "skills", "codex");
    for (const kind of ["plan", "review", "rescue", "result-handling"]) {
      assert.equal(fs.existsSync(path.join(skillsRoot, `grok-${kind}`)), false);
    }
    assert.equal(fs.existsSync(path.join(skillsRoot, "claude-plan")), true); // 其它 target 保留
    const lockPath = path.join(env.HOME, "hosts", "codex.lock.json");
    assert.equal(fs.existsSync(lockPath), true); // lock 保留
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.deepEqual(lock.targets, ["claude"]); // 重写后去掉 grok
  });

  it("install --remove with invalid target exits 2", (t) => {
    const env = makeEnv(t);
    env.HOME = env.AGENT_BRIDGE_HOME;
    const r = run(["install", "--host", "codex", "--remove", "nonsense", "--json"], env);
    assert.equal(r.status, EXIT.USAGE);
    assert.equal(JSON.parse(r.stdout).errorCode, "usage");
  });

  it("--model passes through to target argv", () => {
    const fakeGrok = path.join(root, "tests", "fixtures", "fake-grok.mjs");
    const r = run(["grok", "plan", "--model", "gemini-3.6-flash-high", "--json", "--prompt", "x"], {
      AGENT_BRIDGE_LOCKED_HOST: "claude",
      AGENT_BRIDGE_GROK_BIN: fakeGrok
    });
    assert.equal(r.status, EXIT.OK);
    const args = JSON.parse(r.stdout).metadata.args;
    const mIdx = args.indexOf("-m");
    assert.ok(mIdx >= 0, `expected -m in args: ${JSON.stringify(args)}`);
    assert.equal(args[mIdx + 1], "gemini-3.6-flash-high");
  });
});
