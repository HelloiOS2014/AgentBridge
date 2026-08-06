import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runDelegation } from "../src/core/run.mjs";

const fakeClaude = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-claude.mjs");

describe("runDelegation claude", () => {
  it("plan completes with fake claude and host lock env", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ab-run-"));
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

});
