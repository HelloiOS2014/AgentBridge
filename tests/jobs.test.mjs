import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { cleanupJobs, listJobs, lookupJob, newJobId, registerJob, stateReport } from "../src/core/jobs.mjs";
import { ensureDir } from "../src/core/paths.mjs";

describe("jobs uuid index", () => {
  it("registers and looks up by id without host", (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-state-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
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
  function makeEnv(t) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-state-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    return { AGENT_BRIDGE_STATE_DIR: path.join(home, "state"), AGENT_BRIDGE_HOME: home };
  }
  function writeJob(env, id, host, target, ws, extra = {}) {
    const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, host, target, ws, "jobs", `${id}.json`);
    ensureDir(path.dirname(jobFile));
    fs.writeFileSync(jobFile, JSON.stringify({ id, status: "completed", kind: "plan", summary: "ok", ...extra }, null, 2), "utf8");
    return jobFile;
  }

  it("scan fallback finds job when index is deleted", (t) => {
    const env = makeEnv(t);
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

  it("scan fallback survives corrupt index", (t) => {
    const env = makeEnv(t);
    const id = newJobId();
    writeJob(env, id, "codex", "grok", "ws2");
    fs.writeFileSync(path.join(env.AGENT_BRIDGE_STATE_DIR, "job-index.json"), "{ not json", "utf8");
    const found = lookupJob(id, env);
    assert.ok(found);
    assert.equal(found.meta.target, "grok");
  });

  it("corrupt job file returns corrupt marker, does not throw", (t) => {
    const env = makeEnv(t);
    const id = newJobId();
    const jobFile = writeJob(env, id, "claude", "codex", "ws3");
    fs.writeFileSync(jobFile, "{ broken", "utf8");
    registerJob({ id, host: "claude", target: "codex", workspaceHash: "ws3", jobFile, env });
    const found = lookupJob(id, env);
    assert.equal(found.corrupt, true);
  });

  it("missing id returns null", (t) => {
    const env = makeEnv(t);
    assert.equal(lookupJob(newJobId(), env), null);
  });
});

describe("jobs list / report / cleanup", () => {
  function makeEnv(t) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-state-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    return { AGENT_BRIDGE_STATE_DIR: path.join(home, "state"), AGENT_BRIDGE_HOME: home };
  }
  function seed(env, host, target, ws, id) {
    const jobFile = path.join(env.AGENT_BRIDGE_STATE_DIR, host, target, ws, "jobs", `${id}.json`);
    ensureDir(path.dirname(jobFile));
    fs.writeFileSync(jobFile, JSON.stringify({ id, status: "completed", kind: "plan", summary: "s", host, target }, null, 2), "utf8");
    return jobFile;
  }

  it("listJobs scans across buckets", (t) => {
    const env = makeEnv(t);
    seed(env, "codex", "claude", "ws1", newJobId());
    seed(env, "claude", "grok", "ws2", newJobId());
    const jobs = listJobs(env);
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((j) => j.jobId && j.host && j.target && j.path));
  });

  it("stateReport counts buckets and bytes", (t) => {
    const env = makeEnv(t);
    seed(env, "codex", "claude", "ws1", newJobId());
    seed(env, "codex", "claude", "ws1", newJobId());
    const report = stateReport(env);
    assert.equal(report.jobCount, 2);
    assert.deepEqual(report.buckets, [{ bucket: "codex/claude", count: 2 }]);
    assert.ok(report.totalBytes > 0);
  });

  it("cleanupJobs requires scope", (t) => {
    const env = makeEnv(t);
    assert.throws(() => cleanupJobs(env, {}), /--all or --host\/--target/);
  });

  it("cleanupJobs --all deletes and rebuilds index", (t) => {
    const env = makeEnv(t);
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
