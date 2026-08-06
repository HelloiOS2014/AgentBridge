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
