import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { lookupJob, newJobId, registerJob } from "../src/core/jobs.mjs";
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
