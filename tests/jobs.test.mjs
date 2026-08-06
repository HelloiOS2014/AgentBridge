import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { cleanupJobs, listJobs, lookupJob, newJobId, pruneExpiredJobs, registerJob, stateReport } from "../src/core/jobs.mjs";
import { ensureDir } from "../src/core/paths.mjs";

describe("jobs uuid index", () => {
  it("registers and looks up by id without host", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-state-"));
    const env = { AGENT_BRIDGE_STATE_DIR: path.join(home, "state"), AGENT_BRIDGE_HOME: home };
    const id = newJobId();
    const jobFile = path.join(home, "state", "codex", "claude", "ws", "jobs", `${id}.json`);
    ensureDir(path.dirname(jobFile));
    fs.writeFileSync(
      jobFile,
      JSON.stringify({ id, status: "completed", kind: "plan", summary: "ok" }, null, 2),
      "utf8"
    );
    registerJob({
      id,
      host: "codex",
      target: "claude",
      workspaceHash: "ws",
      jobFile,
      env
    });
    const found = lookupJob(id, env);
    assert.ok(found);
    assert.equal(found.job.id, id);
    assert.equal(found.meta.host, "codex");
  });
});

describe("jobs index resilience", () => {
  function makeEnv() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-state-"));
    return { AGENT_BRIDGE_STATE_DIR: path.join(home, "state"), AGENT_BRIDGE_HOME: home };
  }
  function writeJob(env, id, host, target, ws, extra = {}) {
    const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, host, target, ws, "jobs", `${id}.json`);
    ensureDir(path.dirname(jobFile));
    fs.writeFileSync(jobFile, JSON.stringify({ id, status: "completed", kind: "plan", summary: "ok", ...extra }, null, 2), "utf8");
    return jobFile;
  }

  it("scan fallback finds job when index is deleted", () => {
    const env = makeEnv();
    const id = newJobId();
    const jobFile = writeJob(env, id, "codex", "claude", "ws1");
    registerJob({ id, host: "codex", target: "claude", workspaceHash: "ws1", jobFile, env });
    fs.rmSync(path.join(env.AGENT_BRIDGE_STATE_DIR, "job-index.json"), { force: true });
    const found = lookupJob(id, env);
    assert.ok(found);
    assert.equal(found.job.id, id);
    assert.equal(found.meta.host, "codex"); // 从路径重推导
    // scan fallback rewrites the index, so a second lookup still works
    assert.equal(lookupJob(id, env).job.id, id);
  });

  it("scan fallback survives corrupt index", () => {
    const env = makeEnv();
    const id = newJobId();
    writeJob(env, id, "codex", "grok", "ws2");
    fs.writeFileSync(path.join(env.AGENT_BRIDGE_STATE_DIR, "job-index.json"), "{ not json", "utf8");
    const found = lookupJob(id, env);
    assert.ok(found);
    assert.equal(found.meta.target, "grok");
  });

  it("corrupt job file returns corrupt marker, does not throw", () => {
    const env = makeEnv();
    const id = newJobId();
    const jobFile = writeJob(env, id, "claude", "codex", "ws3");
    fs.writeFileSync(jobFile, "{ broken", "utf8");
    registerJob({ id, host: "claude", target: "codex", workspaceHash: "ws3", jobFile, env });
    const found = lookupJob(id, env);
    assert.equal(found.corrupt, true);
  });

  it("missing id returns null", () => {
    const env = makeEnv();
    assert.equal(lookupJob(newJobId(), env), null);
  });
});

describe("jobs list / report / cleanup", () => {
  function makeEnv() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-state-"));
    return { AGENT_BRIDGE_STATE_DIR: path.join(home, "state"), AGENT_BRIDGE_HOME: home };
  }
  function seed(env, host, target, ws, id) {
    const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, host, target, ws, "jobs", `${id}.json`);
    ensureDir(path.dirname(jobFile));
    fs.writeFileSync(jobFile, JSON.stringify({ id, status: "completed", kind: "plan", summary: "s", host, target }, null, 2), "utf8");
    return jobFile;
  }

  it("listJobs scans across buckets", () => {
    const env = makeEnv();
    seed(env, "codex", "claude", "ws1", newJobId());
    seed(env, "claude", "grok", "ws2", newJobId());
    const jobs = listJobs(env);
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((j) => j.jobId && j.host && j.target && j.path));
  });

  it("stateReport counts buckets and bytes", () => {
    const env = makeEnv();
    seed(env, "codex", "claude", "ws1", newJobId());
    seed(env, "codex", "claude", "ws1", newJobId());
    const report = stateReport(env);
    assert.equal(report.jobCount, 2);
    assert.deepEqual(report.buckets, [{ bucket: "codex/claude", count: 2 }]);
    assert.ok(report.totalBytes > 0);
  });

  it("cleanupJobs requires scope", () => {
    const env = makeEnv();
    assert.throws(() => cleanupJobs(env, {}), /--all or --host\/--target/);
  });

  it("cleanupJobs --all deletes and rebuilds index", () => {
    const env = makeEnv();
    const id = newJobId();
    const jobFile = seed(env, "codex", "grok", "ws3", id);
    registerJob({ id, host: "codex", target: "grok", workspaceHash: "ws3", jobFile, env });
    const res = cleanupJobs(env, { all: true });
    assert.equal(res.deleted, 1);
    assert.equal(res.remaining, 0);
    assert.equal(fs.existsSync(jobFile), false);
    assert.equal(lookupJob(id, env), null); // 索引已重建，不再有孤儿条目
  });
});

describe("jobs ttl prune (T1.4)", () => {
  function makeEnv(extra = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-state-"));
    return { AGENT_BRIDGE_STATE_DIR: path.join(home, "state"), AGENT_BRIDGE_HOME: home, ...extra };
  }
  function seed(env, host, target, ws, id, extra = {}) {
    const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, host, target, ws, "jobs", `${id}.json`);
    ensureDir(path.dirname(jobFile));
    fs.writeFileSync(jobFile, JSON.stringify({ id, status: "completed", kind: "plan", summary: "s", host, target, ...extra }, null, 2), "utf8");
    return jobFile;
  }
  const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

  it("listJobs includes status field", () => {
    const env = makeEnv();
    const id = newJobId();
    seed(env, "codex", "claude", "ws", id, { status: "failed" });
    const jobs = listJobs(env);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "failed");
  });

  it("pruneExpiredJobs deletes old jobs and rebuilds index", () => {
    const env = makeEnv();
    const oldId = newJobId();
    const oldFile = seed(env, "codex", "claude", "ws1", oldId);
    const newId = newJobId();
    const newFile = seed(env, "codex", "claude", "ws1", newId);
    registerJob({ id: oldId, host: "codex", target: "claude", workspaceHash: "ws1", jobFile: oldFile, env });
    const old = new Date(Date.now() - TEN_DAYS_MS);
    fs.utimesSync(oldFile, old, old);
    const res = pruneExpiredJobs(env, 7);
    assert.equal(res.deleted, 1);
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(newFile), true);
    assert.equal(lookupJob(oldId, env), null); // 索引已重建，无孤儿条目
  });

  it("running jobs are never pruned", () => {
    const env = makeEnv();
    const id = newJobId();
    const jobFile = seed(env, "codex", "claude", "ws", id, { status: "running" });
    const old = new Date(Date.now() - TEN_DAYS_MS);
    fs.utimesSync(jobFile, old, old);
    const res = pruneExpiredJobs(env, 7);
    assert.equal(res.deleted, 0);
    assert.equal(fs.existsSync(jobFile), true);
  });

  it("cancelled and completed jobs are pruned", () => {
    const env = makeEnv();
    const cancelled = newJobId();
    const completed = newJobId();
    const cFile = seed(env, "codex", "claude", "ws", cancelled, { status: "cancelled" });
    const dFile = seed(env, "codex", "claude", "ws", completed, { status: "completed" });
    const old = new Date(Date.now() - TEN_DAYS_MS);
    fs.utimesSync(cFile, old, old);
    fs.utimesSync(dFile, old, old);
    const res = pruneExpiredJobs(env, 7);
    assert.equal(res.deleted, 2);
  });

  it("TTL <= 0 disables pruning", () => {
    const env = makeEnv({ AGENT_BRIDGE_JOB_TTL_DAYS: "0" });
    const id = newJobId();
    const jobFile = seed(env, "codex", "claude", "ws", id);
    const old = new Date(Date.now() - TEN_DAYS_MS);
    fs.utimesSync(jobFile, old, old);
    assert.equal(pruneExpiredJobs(env).deleted, 0);
    assert.equal(pruneExpiredJobs(env, 0).deleted, 0);
    assert.equal(fs.existsSync(jobFile), true);
  });
});
